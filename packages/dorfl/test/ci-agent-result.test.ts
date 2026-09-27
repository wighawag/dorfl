import {describe, it, expect, vi, afterEach} from 'vitest';
import {
	AgentResultUsageError,
	MAX_API_PAGES,
	actionsRunRefFromEnv,
	decideAgentResult,
	detectAgentTimeout,
	githubTokenApiGet,
	isAgentJobName,
	parseAgentJobResult,
	parseAgentTimeoutMinutes,
	type ActionsRunRef,
	type CancelVerdict,
	type GithubApiGet,
} from '../src/ci-agent-result.js';

/**
 * Telling a timed-out agent job from a cancelled one with a stubbed Actions API
 * (task `ci-split-agent-result-and-reruns`, decision 5, finding
 * `github-actions-job-timeout-reported-as-cancelled`).
 */

const API = 'https://api.github.example';
const RUN: ActionsRunRef = {
	apiUrl: API,
	repository: 'o/r',
	runId: '77',
	runAttempt: '2',
};
const JOBS_URL = `${API}/repos/o/r/actions/runs/77/attempts/2/jobs?per_page=100`;
const AGENT_ID = 4242;
const ANNOTATIONS_URL = `${API}/repos/o/r/check-runs/${AGENT_ID}/annotations?per_page=100`;
const TIMEOUT_TEXT =
	'The job has exceeded the maximum execution time of 1h30m0s';
const CANCEL_TEXT = 'The run was canceled by @user.';

interface Job {
	id: number;
	name: string;
	started_at?: string | null;
	completed_at?: string | null;
}

/** A job that ran `minutes` minutes. */
function agentJob(minutes: number, name = 'item / agent'): Job {
	const start = Date.parse('2026-09-27T10:00:00Z');
	return {
		id: AGENT_ID,
		name,
		started_at: new Date(start).toISOString(),
		completed_at: new Date(start + minutes * 60_000).toISOString(),
	};
}

/**
 * A stub API: the jobs listing (one page) and the annotation pages. Records the
 * URLs it was asked for.
 */
function stubApi(opts: {
	jobs?: Job[];
	annotationPages?: string[][];
	jobsStatus?: number;
	annotationsStatus?: number;
}): {get: GithubApiGet; urls: string[]} {
	const urls: string[] = [];
	const pages = opts.annotationPages ?? [[]];
	const get: GithubApiGet = async (url) => {
		urls.push(url);
		if (url === JOBS_URL) {
			return {
				status: opts.jobsStatus ?? 200,
				body: {
					total_count: (opts.jobs ?? []).length,
					jobs: [
						{id: 1, name: 'item / lock', started_at: null},
						...(opts.jobs ?? []),
						{id: 3, name: 'item / apply', started_at: null},
					],
				},
			};
		}
		const page = annotationPage(url);
		if (page !== undefined) {
			const messages = pages[page - 1] ?? [];
			return {
				status: opts.annotationsStatus ?? 200,
				body: messages.map((message) => ({
					annotation_level: 'failure',
					message,
					title: '',
				})),
				next:
					page < pages.length
						? `${ANNOTATIONS_URL}&page=${page + 1}`
						: undefined,
			};
		}
		return {status: 404, body: {message: 'Not Found'}};
	};
	return {get, urls};
}

function annotationPage(url: string): number | undefined {
	if (url === ANNOTATIONS_URL) return 1;
	const m = /&page=([0-9]+)$/.exec(url);
	if (m !== null && url.startsWith(ANNOTATIONS_URL)) return Number(m[1]);
	return undefined;
}

function detect(
	get: GithubApiGet | undefined,
	agentTimeoutMinutes: number | undefined = 90,
): Promise<CancelVerdict> {
	return detectAgentTimeout({get, run: RUN, agentTimeoutMinutes});
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('timeout versus cancel (a cancelled agent job)', () => {
	it('an annotation containing "exceeded the maximum execution time" is a timeout', async () => {
		const {get} = stubApi({
			jobs: [agentJob(10)],
			annotationPages: [[TIMEOUT_TEXT, 'The operation was canceled.']],
		});
		expect((await detect(get)).kind).toBe('timeout');
	});

	it('"The run was canceled by @user" is a real cancel', async () => {
		const {get} = stubApi({
			jobs: [agentJob(10)],
			annotationPages: [[CANCEL_TEXT, 'The operation was canceled.']],
		});
		expect((await detect(get)).kind).toBe('cancel');
	});

	it('a forged timeout annotation next to a real cancel is a timeout (the safe side)', async () => {
		const {get} = stubApi({
			jobs: [agentJob(3)],
			annotationPages: [[`forged: ${TIMEOUT_TEXT}`, CANCEL_TEXT]],
		});
		expect((await detect(get)).kind).toBe('timeout');
	});

	it('an API error is unreadable (surfaced)', async () => {
		expect(
			(await detect(stubApi({jobs: [agentJob(3)], jobsStatus: 500}).get)).kind,
		).toBe('unreadable');
		expect(
			(await detect(stubApi({jobs: [agentJob(3)], annotationsStatus: 403}).get))
				.kind,
		).toBe('unreadable');
		const throwing: GithubApiGet = async () => {
			throw new Error('network down');
		};
		expect((await detect(throwing)).kind).toBe('unreadable');
	});

	it('no token, no run reference or no agent job is unreadable', async () => {
		expect((await detect(undefined)).kind).toBe('unreadable');
		expect(
			(
				await detectAgentTimeout({
					get: stubApi({jobs: [agentJob(3)]}).get,
					run: undefined,
					agentTimeoutMinutes: 90,
				})
			).kind,
		).toBe('unreadable');
		expect((await detect(stubApi({jobs: []}).get)).kind).toBe('unreadable');
		// Two jobs named '/ agent' cannot be told apart.
		const two = stubApi({
			jobs: [agentJob(3), {...agentJob(3), id: 99, name: 'other / agent'}],
		});
		expect((await detect(two.get)).kind).toBe('unreadable');
	});

	it('the timeout annotation only on page 2 is found', async () => {
		const {get, urls} = stubApi({
			jobs: [agentJob(10)],
			annotationPages: [
				Array.from({length: 100}, (_, i) => `::error::noise ${i}`),
				[TIMEOUT_TEXT],
			],
		});
		expect((await detect(get)).kind).toBe('timeout');
		expect(urls).toContain(`${ANNOTATIONS_URL}&page=2`);
	});

	it('a duration within one minute of agentTimeoutMinutes is a timeout without any annotation', async () => {
		const {get} = stubApi({
			jobs: [agentJob(89.5)],
			annotationPages: [[CANCEL_TEXT]],
		});
		expect((await detect(get, 90)).kind).toBe('timeout');
	});

	it('a shorter cancelled job without the annotation is a cancel', async () => {
		const {get} = stubApi({
			jobs: [agentJob(88.5)],
			annotationPages: [[CANCEL_TEXT]],
		});
		expect((await detect(get, 90)).kind).toBe('cancel');
	});

	it('without a trusted timeout, a cancel without the annotation is unreadable', async () => {
		const {get} = stubApi({
			jobs: [agentJob(3)],
			annotationPages: [[CANCEL_TEXT]],
		});
		const verdict = await detectAgentTimeout({
			get,
			run: RUN,
			agentTimeoutMinutes: undefined,
		});
		expect(verdict.kind).toBe('unreadable');
	});

	it('a job without timestamps is unreadable unless the annotation says timeout', async () => {
		const noTimes: Job = {id: AGENT_ID, name: 'item / agent'};
		expect(
			(await detect(stubApi({jobs: [noTimes], annotationPages: [[]]}).get))
				.kind,
		).toBe('unreadable');
		expect(
			(
				await detect(
					stubApi({jobs: [noTimes], annotationPages: [[TIMEOUT_TEXT]]}).get,
				)
			).kind,
		).toBe('timeout');
	});

	it('a listing with more pages than the cap is unreadable', async () => {
		const pages = Array.from({length: MAX_API_PAGES + 1}, () => [CANCEL_TEXT]);
		const {get} = stubApi({jobs: [agentJob(3)], annotationPages: pages});
		expect((await detect(get)).kind).toBe('unreadable');
	});

	it('a next page outside the API is unreadable (the token is not sent elsewhere)', async () => {
		const urls: string[] = [];
		const get: GithubApiGet = async (url) => {
			urls.push(url);
			if (url === JOBS_URL) {
				return {status: 200, body: {jobs: [agentJob(3)]}};
			}
			return {status: 200, body: [], next: 'https://evil.example/x'};
		};
		expect((await detect(get)).kind).toBe('unreadable');
		expect(urls).not.toContain('https://evil.example/x');
	});

	it('annotation text is never written to the output or the verdict', async () => {
		const hostile = `::error::${TIMEOUT_TEXT} ::add-mask::secret`;
		const writes: string[] = [];
		const capture = (chunk: unknown): boolean => {
			writes.push(String(chunk));
			return true;
		};
		vi.spyOn(process.stdout, 'write').mockImplementation(capture);
		vi.spyOn(process.stderr, 'write').mockImplementation(capture);
		for (const method of ['log', 'info', 'warn', 'error'] as const) {
			vi.spyOn(console, method).mockImplementation((...a: unknown[]) => {
				writes.push(a.map(String).join(' '));
			});
		}
		const verdicts: CancelVerdict[] = [];
		verdicts.push(
			await detect(
				stubApi({jobs: [agentJob(3)], annotationPages: [[hostile]]}).get,
			),
		);
		verdicts.push(
			await detect(
				stubApi({jobs: [agentJob(3)], annotationPages: [['::error::x']]}).get,
			),
		);
		const decision = await decideAgentResult({
			result: 'cancelled',
			needsAgent: true,
			detectTimeout: async () => verdicts[0]!,
		});
		vi.restoreAllMocks();
		expect(verdicts.map((v) => v.kind)).toEqual(['timeout', 'cancel']);
		const everything = [
			...writes,
			...verdicts.map((v) => v.why),
			JSON.stringify(decision),
		].join('\n');
		expect(everything).not.toContain('::error::');
		expect(everything).not.toContain('::add-mask::');
	});
});

describe('the agent job lookup', () => {
	it('matches `item / agent` in a called workflow, and `agent` in a plain one', () => {
		expect(isAgentJobName('item / agent')).toBe(true);
		expect(isAgentJobName('dorfl-item / agent')).toBe(true);
		expect(isAgentJobName('agent')).toBe(true);
		expect(isAgentJobName('item / lock')).toBe(false);
		expect(isAgentJobName('item / agent-helper')).toBe(false);
		expect(isAgentJobName('reagent')).toBe(false);
	});

	it('finds the agent job of THIS run attempt in a called workflow', async () => {
		const {get, urls} = stubApi({
			jobs: [agentJob(10, 'item / agent')],
			annotationPages: [[TIMEOUT_TEXT]],
		});
		expect((await detect(get)).kind).toBe('timeout');
		expect(urls[0]).toBe(JOBS_URL);
		expect(urls[1]).toBe(ANNOTATIONS_URL);
	});
});

describe('the decision per agent result', () => {
	const never = async (): Promise<CancelVerdict> => {
		throw new Error('the API must not be read');
	};

	it('success reads the handoff; failure surfaces; neither reads the API', async () => {
		expect(
			await decideAgentResult({
				result: 'success',
				needsAgent: true,
				detectTimeout: never,
			}),
		).toEqual({action: 'read-handoff'});
		expect(
			(
				await decideAgentResult({
					result: 'failure',
					needsAgent: true,
					detectTimeout: never,
				})
			).action,
		).toBe('surface');
	});

	it('skipped is the deterministic rung only when the lock said needsAgent: false', async () => {
		expect(
			await decideAgentResult({
				result: 'skipped',
				needsAgent: false,
				detectTimeout: never,
			}),
		).toEqual({action: 'deterministic'});
		for (const needsAgent of [true, undefined]) {
			expect(
				(
					await decideAgentResult({
						result: 'skipped',
						needsAgent,
						detectTimeout: never,
					})
				).action,
			).toBe('surface');
		}
	});

	it('cancelled: a timeout or an unreadable job surfaces, a real cancel releases', async () => {
		const decide = (verdict: CancelVerdict) =>
			decideAgentResult({
				result: 'cancelled',
				needsAgent: true,
				detectTimeout: async () => verdict,
			});
		expect((await decide({kind: 'timeout', why: 'x'})).action).toBe('surface');
		expect((await decide({kind: 'unreadable', why: 'x'})).action).toBe(
			'surface',
		);
		expect((await decide({kind: 'cancel', why: 'x'})).action).toBe('release');
	});
});

describe('the inputs', () => {
	it('parses --agent-result and --agent-timeout-minutes strictly', () => {
		expect(parseAgentJobResult('cancelled')).toBe('cancelled');
		expect(() => parseAgentJobResult('Success')).toThrow(AgentResultUsageError);
		expect(() => parseAgentJobResult('')).toThrow(AgentResultUsageError);
		expect(parseAgentTimeoutMinutes('90')).toBe(90);
		for (const bad of ['0', '-1', '1.5', 'ninety', '']) {
			expect(() => parseAgentTimeoutMinutes(bad)).toThrow(
				AgentResultUsageError,
			);
		}
	});

	it('reads the run reference from the Actions environment', () => {
		expect(
			actionsRunRefFromEnv({
				GITHUB_REPOSITORY: 'o/r',
				GITHUB_RUN_ID: '77',
				GITHUB_RUN_ATTEMPT: '2',
				GITHUB_API_URL: `${API}/`,
			}),
		).toEqual(RUN);
		expect(
			actionsRunRefFromEnv({GITHUB_RUN_ID: '77', GITHUB_RUN_ATTEMPT: '2'}),
		).toBeUndefined();
	});

	it('reads the API with GITHUB_TOKEN only, never GH_TOKEN / DORFL_GH_TOKEN', async () => {
		expect(
			githubTokenApiGet({GH_TOKEN: 'write', DORFL_GH_TOKEN: 'write'}),
		).toBeUndefined();
		const seen: Array<Record<string, string>> = [];
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
			seen.push((init?.headers ?? {}) as Record<string, string>);
			return new Response('[]', {
				status: 200,
				headers: {link: `<${API}/next?page=2>; rel="next"`},
			});
		});
		const get = githubTokenApiGet({
			GITHUB_TOKEN: 'job-token',
			GH_TOKEN: 'write',
			DORFL_GH_TOKEN: 'write',
		})!;
		const r = await get(`${API}/x`);
		expect(r).toEqual({status: 200, body: [], next: `${API}/next?page=2`});
		expect(seen[0]!.authorization).toBe('Bearer job-token');
	});
});
