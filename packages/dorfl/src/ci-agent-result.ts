/**
 * **What the apply phase does with the agent job's result** (spec
 * `ci-agent-job-without-write-token` §8 "Agent result", decision 5 of ADR
 * `ci-agent-job-holds-no-write-token`, task `ci-split-agent-result-and-reruns`).
 *
 * The apply job receives `needs.agent.result` (`--agent-result`). It is part of
 * the HOSTILE channel: `success` is only the precondition for reading the
 * artifact, never evidence that its content is good. Every other result never
 * reads the artifact:
 *
 *  - `failure`: surface the item to needs-attention (the lock is released);
 *  - `cancelled`: GitHub reports a TIMED-OUT job as `cancelled` too (measured,
 *    finding `github-actions-job-timeout-reported-as-cancelled`), so the apply
 *    job reads the agent job from the Actions API ({@link detectAgentTimeout}).
 *    A timeout surfaces; a real cancel only releases the lock; anything it
 *    cannot read surfaces (the safe side);
 *  - `skipped`: accepted only when the lock job said `needsAgent: false` (the
 *    apply job then runs the deterministic rung itself); otherwise it is a
 *    failure.
 *
 * This module DECIDES; each path split acts on the decision (its surface and
 * its release differ: a task lock, an intake label).
 */

/** The values of `needs.<job>.result` GitHub Actions reports. */
export const AGENT_JOB_RESULTS = [
	'success',
	'failure',
	'cancelled',
	'skipped',
] as const;

/** `needs.agent.result`, as the apply job receives it. */
export type AgentJobResult = (typeof AGENT_JOB_RESULTS)[number];

/** A malformed `--agent-result` or `--agent-timeout-minutes`. */
export class AgentResultUsageError extends Error {
	override readonly name = 'AgentResultUsageError';
}

/** Parse `--agent-result` (exactly one of {@link AGENT_JOB_RESULTS}). */
export function parseAgentJobResult(raw: string): AgentJobResult {
	if ((AGENT_JOB_RESULTS as readonly string[]).includes(raw)) {
		return raw as AgentJobResult;
	}
	throw new AgentResultUsageError(
		`--agent-result must be one of ${AGENT_JOB_RESULTS.join(', ')} ` +
			`(needs.agent.result); got ${JSON.stringify(raw.slice(0, 40))}`,
	);
}

/** Parse `--agent-timeout-minutes` (a positive integer, the lock output). */
export function parseAgentTimeoutMinutes(raw: string): number {
	const n = /^[0-9]{1,9}$/.test(raw) ? Number(raw) : Number.NaN;
	if (!Number.isInteger(n) || n < 1) {
		throw new AgentResultUsageError(
			'--agent-timeout-minutes must be a positive integer ' +
				'(needs.lock.outputs.agentTimeoutMinutes)',
		);
	}
	return n;
}

/**
 * The fragment of GitHub's timeout annotation ("The job has exceeded the maximum
 * execution time of <duration>"), matched as a substring only.
 */
export const TIMEOUT_ANNOTATION_FRAGMENT =
	'exceeded the maximum execution time';

/**
 * The tolerance under `agentTimeoutMinutes` at which the agent job's duration
 * already counts as a timeout: the job clock may start after `started_at`.
 */
export const TIMEOUT_TOLERANCE_MS = 60_000;

/** The most pages {@link detectAgentTimeout} reads from one listing. */
export const MAX_API_PAGES = 50;

/**
 * One GET against the GitHub REST API: the status, the parsed JSON body and the
 * `rel="next"` page URL from the `Link` header. Tests stub it.
 */
export type GithubApiGet = (
	url: string,
) => Promise<{status: number; body: unknown; next?: string}>;

/** How a cancelled agent job ended, as far as the Actions API tells. */
export type CancelVerdict =
	/** The job hit its `timeout-minutes` (either signal said so). */
	| {kind: 'timeout'; why: string}
	/** A real cancel (a human, or a newer run's concurrency). */
	| {kind: 'cancel'; why: string}
	/** The API could not be read, or the job not found: treated as a timeout. */
	| {kind: 'unreadable'; why: string};

/** Where the Actions API reads of {@link detectAgentTimeout} go. */
export interface ActionsRunRef {
	/** `GITHUB_API_URL` (default `https://api.github.com`). */
	apiUrl: string;
	/** `GITHUB_REPOSITORY` (`owner/repo`). */
	repository: string;
	/** `GITHUB_RUN_ID`. */
	runId: string;
	/** `GITHUB_RUN_ATTEMPT`. */
	runAttempt: string;
}

/**
 * The run this apply job belongs to, from the Actions environment, or
 * `undefined` when any part is missing (the caller then surfaces).
 */
export function actionsRunRefFromEnv(
	env: NodeJS.ProcessEnv,
): ActionsRunRef | undefined {
	const repository = env.GITHUB_REPOSITORY;
	const runId = env.GITHUB_RUN_ID;
	const runAttempt = env.GITHUB_RUN_ATTEMPT;
	if (
		repository === undefined ||
		!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
		runId === undefined ||
		!/^[0-9]+$/.test(runId) ||
		runAttempt === undefined ||
		!/^[0-9]+$/.test(runAttempt)
	) {
		return undefined;
	}
	const apiUrl = (env.GITHUB_API_URL ?? 'https://api.github.com').replace(
		/\/+$/,
		'',
	);
	return {apiUrl, repository, runId, runAttempt};
}

/**
 * A {@link GithubApiGet} over `fetch` authenticated with `GITHUB_TOKEN` ONLY:
 * the job's own token, which the apply job grants `actions: read` and
 * `checks: read`. Never `GH_TOKEN` / `DORFL_GH_TOKEN` (the write credential has
 * no business reading this). `undefined` when `GITHUB_TOKEN` is not set.
 */
export function githubTokenApiGet(
	env: NodeJS.ProcessEnv,
): GithubApiGet | undefined {
	const token = env.GITHUB_TOKEN?.trim();
	if (token === undefined || token === '') return undefined;
	return async (url) => {
		const res = await fetch(url, {
			headers: {
				accept: 'application/vnd.github+json',
				authorization: `Bearer ${token}`,
				'x-github-api-version': '2022-11-28',
			},
		});
		let body: unknown;
		try {
			body = await res.json();
		} catch {
			body = undefined;
		}
		const link = res.headers.get('link') ?? '';
		const next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1];
		return {status: res.status, body, next};
	};
}

/**
 * GET every page of a listing (following `rel="next"`), handing each page's
 * body to `onPage`. Throws on a non-200 page, on a next URL outside `apiUrl`,
 * or past {@link MAX_API_PAGES}.
 */
async function eachPage(
	get: GithubApiGet,
	apiUrl: string,
	first: string,
	onPage: (body: unknown) => void,
): Promise<void> {
	let url: string | undefined = first;
	for (let page = 1; url !== undefined; page++) {
		if (page > MAX_API_PAGES) {
			throw new Error(`more than ${MAX_API_PAGES} pages`);
		}
		if (!url.startsWith(`${apiUrl}/`)) {
			throw new Error('a next page points outside the API');
		}
		const r = await get(url);
		if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
		onPage(r.body);
		url = r.next;
	}
}

/** One agent job, as the jobs API describes it (only the fields read). */
interface AgentJob {
	id: number;
	startedAt?: string;
	completedAt?: string;
}

/**
 * Is this job the item's agent job? Inside a called workflow the job is named
 * `<caller job> / agent`; a workflow that is not called names it `agent`.
 */
export function isAgentJobName(name: string): boolean {
	return name === 'agent' || name.endsWith(' / agent');
}

/**
 * Tell a timed-out agent job from a cancelled one (decision 5). Two signals,
 * either one meaning timeout:
 *
 *  - an annotation of the agent job's check run containing
 *    {@link TIMEOUT_ANNOTATION_FRAGMENT}, read across EVERY page;
 *  - the job's `completed_at - started_at` (written by GitHub, not the agent)
 *    reaching `agentTimeoutMinutes` minus {@link TIMEOUT_TOLERANCE_MS}.
 *
 * Anything it cannot establish (no token, an API error, no single agent job in
 * this run attempt, no timestamps, no trusted timeout) is `unreadable`, which
 * the caller surfaces. Annotation text is agent-controllable (a job can write
 * `::error::` lines): it is only substring-matched, and NEVER copied into the
 * verdict, a note or the output.
 */
export async function detectAgentTimeout(params: {
	get: GithubApiGet | undefined;
	run: ActionsRunRef | undefined;
	agentTimeoutMinutes: number | undefined;
}): Promise<CancelVerdict> {
	const {get, run, agentTimeoutMinutes} = params;
	if (get === undefined) {
		return {
			kind: 'unreadable',
			why: 'GITHUB_TOKEN is not set, so the agent job could not be read',
		};
	}
	if (run === undefined) {
		return {
			kind: 'unreadable',
			why:
				'GITHUB_REPOSITORY, GITHUB_RUN_ID or GITHUB_RUN_ATTEMPT is not set, ' +
				'so the agent job could not be read',
		};
	}
	const repo = `${run.apiUrl}/repos/${run.repository}`;

	const agents: AgentJob[] = [];
	try {
		await eachPage(
			get,
			run.apiUrl,
			`${repo}/actions/runs/${run.runId}/attempts/${run.runAttempt}/jobs?per_page=100`,
			(body) => {
				const jobs = (body as {jobs?: unknown} | undefined)?.jobs;
				if (!Array.isArray(jobs)) throw new Error('no jobs list');
				for (const job of jobs as Array<Record<string, unknown>>) {
					if (typeof job.name !== 'string' || !isAgentJobName(job.name)) {
						continue;
					}
					if (typeof job.id !== 'number' || !Number.isSafeInteger(job.id)) {
						throw new Error('an agent job without an id');
					}
					agents.push({
						id: job.id,
						startedAt:
							typeof job.started_at === 'string' ? job.started_at : undefined,
						completedAt:
							typeof job.completed_at === 'string'
								? job.completed_at
								: undefined,
					});
				}
			},
		);
	} catch (err) {
		return {
			kind: 'unreadable',
			why: `the jobs of run ${run.runId} attempt ${run.runAttempt} could not be read (${errorText(err)})`,
		};
	}
	if (agents.length !== 1) {
		return {
			kind: 'unreadable',
			why:
				`run ${run.runId} attempt ${run.runAttempt} has ${agents.length} ` +
				`jobs named '/ agent', not exactly one`,
		};
	}
	const agent = agents[0]!;

	// Signal 1: the duration GitHub recorded (the agent cannot write it).
	const started = Date.parse(agent.startedAt ?? '');
	const completed = Date.parse(agent.completedAt ?? '');
	let durationKnown = false;
	if (Number.isFinite(started) && Number.isFinite(completed)) {
		durationKnown = true;
		if (
			agentTimeoutMinutes !== undefined &&
			completed - started >= agentTimeoutMinutes * 60_000 - TIMEOUT_TOLERANCE_MS
		) {
			const minutes = Math.floor((completed - started) / 60_000);
			return {
				kind: 'timeout',
				why:
					`the agent job ran ${minutes} minute(s), within a minute of its ` +
					`${agentTimeoutMinutes}-minute timeout`,
			};
		}
	}

	// Signal 2: GitHub's timeout annotation, on ANY page.
	let annotated = false;
	try {
		await eachPage(
			get,
			run.apiUrl,
			`${repo}/check-runs/${agent.id}/annotations?per_page=100`,
			(body) => {
				if (!Array.isArray(body)) throw new Error('no annotations list');
				for (const a of body as Array<Record<string, unknown>>) {
					for (const field of [a.message, a.title]) {
						if (
							typeof field === 'string' &&
							field.includes(TIMEOUT_ANNOTATION_FRAGMENT)
						) {
							annotated = true;
						}
					}
				}
			},
		);
	} catch (err) {
		return {
			kind: 'unreadable',
			why: `the annotations of the agent job could not be read (${errorText(err)})`,
		};
	}
	if (annotated) {
		return {
			kind: 'timeout',
			why: "the agent job carries GitHub's timeout annotation",
		};
	}
	if (!durationKnown) {
		return {
			kind: 'unreadable',
			why: 'the agent job has no start or completion time',
		};
	}
	if (agentTimeoutMinutes === undefined) {
		return {
			kind: 'unreadable',
			why: 'no trusted agent timeout was given, so its duration cannot be judged',
		};
	}
	return {
		kind: 'cancel',
		why: 'the agent job was cancelled before its timeout',
	};
}

/** Only dorfl's own words: an error thrown by a listing above, or the status. */
function errorText(err: unknown): string {
	// Our own thrown messages carry no API text; a fetch failure's message is
	// the runtime's, never the annotation body.
	return err instanceof Error ? err.message.slice(0, 200) : 'unknown error';
}

/** What the apply phase does, given the agent job's result. */
export type AgentResultDecision =
	/** `success`: read and validate the handoff. */
	| {action: 'read-handoff'}
	/** `skipped` with `needsAgent: false`: run the deterministic rung itself. */
	| {action: 'deterministic'}
	/** Surface the item to needs-attention (and release the lock); no artifact read. */
	| {action: 'surface'; reason: string}
	/** Only release the lock (a real cancel); no artifact read. */
	| {action: 'release'; reason: string};

/**
 * Decide what the apply phase does with `needs.agent.result` (decision 5).
 * `detectTimeout` is called only for `cancelled`.
 */
export async function decideAgentResult(params: {
	result: AgentJobResult;
	needsAgent: boolean | undefined;
	detectTimeout: () => Promise<CancelVerdict>;
}): Promise<AgentResultDecision> {
	switch (params.result) {
		case 'success':
			return {action: 'read-handoff'};
		case 'skipped':
			if (params.needsAgent === false) return {action: 'deterministic'};
			return {
				action: 'surface',
				reason:
					'the agent job was skipped although the lock job said the item ' +
					'needs an agent (treated as an agent failure); the handoff was not read',
			};
		case 'failure':
			return {
				action: 'surface',
				reason:
					'the agent job failed (see its log in the workflow run); the handoff ' +
					'was not read',
			};
		case 'cancelled': {
			const verdict = await params.detectTimeout();
			if (verdict.kind === 'cancel') {
				return {
					action: 'release',
					reason: `${verdict.why}; the handoff was not read`,
				};
			}
			const what =
				verdict.kind === 'timeout'
					? `the agent job timed out: ${verdict.why}`
					: `the agent job was cancelled and it could not be told whether it ` +
						`timed out (${verdict.why}), so it is treated as a timeout`;
			return {action: 'surface', reason: `${what}; the handoff was not read`};
		}
	}
}
