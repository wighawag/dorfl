/**
 * **The workflow guard** (spec `ci-agent-job-without-write-token`, testing
 * decision 1; ADR `ci-agent-job-holds-no-write-token`; task
 * `ci-split-generate-workflows`).
 *
 * A checker over PARSED GitHub Actions YAML (never a regex over the raw text)
 * that makes the security boundary of the split CI workflows a test: no job
 * that can write may run an agent, the agent job holds no write credential, and
 * the per-item run shape (one item per run, no shared cache) holds. The guard
 * is pure: it takes the workflow and composite-action files as `{path,
 * content}` pairs (paths relative to the `.github/` base, as the generators
 * emit them) and returns every violation it finds.
 *
 * The rules, per job (a job that `uses:` a local reusable workflow is expanded
 * into the called workflow's jobs, each capped by what the caller grants):
 *
 *  - `agent-verb-in-write-job`: a step runs an agent-spawning `dorfl` verb
 *    ({@link AGENT_SPAWNING_VERBS}, minus {@link SINGLE_JOB_WARNING_EXEMPT_VERBS})
 *    without `--phase lock` / `--phase apply`, in a job whose checkout persists
 *    credentials or whose token has any `write` scope;
 *  - `provider-key-in-write-phase`: a `--phase lock|apply` job references a
 *    provider API key secret;
 *  - `agent-job-foreign-secret`: a `--phase agent` job references a secret other
 *    than the provider key(s) and `GITHUB_TOKEN`;
 *  - `agent-in-matrix`: a `strategy.matrix` job runs an agent-spawning verb, or
 *    calls `dorfl-item.yml` / `dorfl-item-dispatch.yml` (one item per run);
 *  - `cache-restore`: any step (or a step of a local composite action it uses)
 *    restores an Actions cache;
 *  - `actions-write-with-code`: a job holding `actions: write` has a checkout or
 *    a setup step;
 *  - `item-workflow-concurrency`: `dorfl-item.yml` declares a workflow-level
 *    `concurrency`;
 *  - `phase-job-not-hosted`: a lock, agent or apply job does not run on a
 *    GitHub-hosted runner label;
 *  - `caller-does-not-grant`: a job of a called workflow requests a scope its
 *    caller does not grant.
 *
 * The effective token of a job is its `permissions`, else the workflow's, else
 * the REPOSITORY DEFAULT, which counts as write (it may be read-write);
 * `write-all` is write. For a called workflow the caller's grant caps it.
 */

import {parse} from 'yaml';
import {AGENT_SPAWNING_VERBS} from '../../src/phase.js';
import {SINGLE_JOB_WARNING_EXEMPT_VERBS} from '../../src/single-job-warning.js';

/** One file the guard reads: a path relative to the `.github/` base. */
export interface GuardFile {
	/** e.g. `workflows/intake.yml`, `actions/dorfl-setup/action.yml`. */
	path: string;
	content: string;
}

/** One broken rule. */
export interface GuardViolation {
	/** The workflow file (relative to `.github/`). */
	file: string;
	/** The job id; `caller -> called` for a job reached through a call. */
	job: string;
	rule:
		| 'agent-verb-in-write-job'
		| 'provider-key-in-write-phase'
		| 'agent-job-foreign-secret'
		| 'agent-in-matrix'
		| 'cache-restore'
		| 'actions-write-with-code'
		| 'item-workflow-concurrency'
		| 'phase-job-not-hosted'
		| 'caller-does-not-grant';
	detail: string;
}

export interface GuardOptions {
	/** The provider API key secret names (e.g. `ANTHROPIC_API_KEY`). */
	providerKeys: ReadonlySet<string>;
}

type Level = 'none' | 'read' | 'write';
type Perms = Record<string, Level>;
type Step = Record<string, unknown>;
interface Job {
	permissions?: unknown;
	steps?: Step[];
	uses?: string;
	strategy?: {matrix?: unknown};
	'runs-on'?: unknown;
	[key: string]: unknown;
}
interface Workflow {
	permissions?: unknown;
	concurrency?: unknown;
	jobs?: Record<string, Job>;
}

/** Every `GITHUB_TOKEN` scope GitHub knows. */
const SCOPES = [
	'actions',
	'attestations',
	'checks',
	'contents',
	'deployments',
	'discussions',
	'id-token',
	'issues',
	'models',
	'packages',
	'pages',
	'pull-requests',
	'repository-projects',
	'security-events',
	'statuses',
] as const;

const RANK: Record<Level, number> = {none: 0, read: 1, write: 2};

function all(level: Level): Perms {
	return Object.fromEntries(SCOPES.map((s) => [s, level]));
}

/**
 * The token a `permissions` value grants. `undefined` is the repository
 * default, counted as write (it may be read-write).
 */
export function resolvePermissions(value: unknown): Perms {
	if (value === undefined || value === null) return all('write');
	if (value === 'write-all') return all('write');
	if (value === 'read-all') return all('read');
	if (typeof value === 'object' && !Array.isArray(value)) {
		const out = all('none');
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = v === 'write' ? 'write' : v === 'read' ? 'read' : 'none';
		}
		return out;
	}
	return all('write');
}

function cap(perms: Perms, grant: Perms): Perms {
	const out: Perms = {};
	for (const s of new Set([...Object.keys(perms), ...Object.keys(grant)])) {
		const a = perms[s] ?? 'none';
		const b = grant[s] ?? 'none';
		out[s] = RANK[a] <= RANK[b] ? a : b;
	}
	return out;
}

function anyWrite(perms: Perms): boolean {
	return Object.values(perms).includes('write');
}

/** `actions/checkout@<ref>` -> `actions/checkout`, lower-cased. */
function actionName(uses: string): string {
	const at = uses.indexOf('@');
	return (at < 0 ? uses : uses.slice(0, at)).toLowerCase();
}

function isCheckout(step: Step): boolean {
	return (
		typeof step.uses === 'string' &&
		actionName(step.uses) === 'actions/checkout'
	);
}

function withOf(step: Step): Record<string, unknown> {
	return step.with !== null && typeof step.with === 'object'
		? (step.with as Record<string, unknown>)
		: {};
}

/** A checkout that leaves the token in `.git/config` (the default). */
function persistsCredentials(step: Step): boolean {
	const v = withOf(step)['persist-credentials'];
	return !(v === false || String(v) === 'false');
}

/** A setup step: a local action, or a `setup-*` / `action-setup` action. */
function isSetup(step: Step): boolean {
	if (typeof step.uses !== 'string') return false;
	if (step.uses.startsWith('./')) return true;
	return /(^|\/)(setup-[^/]*|action-setup)$/.test(actionName(step.uses));
}

/** Why a step restores an Actions cache, or `undefined`. */
export function cacheRestoreReason(step: Step): string | undefined {
	if (typeof step.uses !== 'string') return undefined;
	const uses = step.uses;
	const name = actionName(uses);
	const w = withOf(step);
	if (name === 'actions/cache' || name === 'actions/cache/restore') {
		return `uses ${uses}`;
	}
	const cache = w.cache;
	if (
		cache !== undefined &&
		cache !== null &&
		cache !== false &&
		String(cache).trim() !== '' &&
		String(cache).trim() !== 'false'
	) {
		return `${uses} with cache: ${String(cache)}`;
	}
	if (name === 'actions/setup-node') {
		const ref = uses.includes('@') ? uses.slice(uses.indexOf('@') + 1) : '';
		const pre5 = /^v[1-4](\.|$)/.test(ref);
		const pmc = w['package-manager-cache'];
		if (!pre5 && pmc !== false && String(pmc) !== 'false') {
			return `${uses} without package-manager-cache: false`;
		}
	}
	return undefined;
}

/** One `dorfl <verb>` command of a `run:` script. */
interface DorflCommand {
	verb: string;
	phase: string | undefined;
	line: string;
}

/** Every `dorfl <verb>` command in a `run:` script (continuations joined). */
export function dorflCommands(script: string): DorflCommand[] {
	const out: DorflCommand[] = [];
	const joined = script.replace(/\\\r?\n/g, ' ');
	for (const line of joined.split(/\r?\n/)) {
		const re = /(?:^|[\s;&|()`])dorfl\s+([a-z][a-z-]*)/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(line)) !== null) {
			const phase = /--phase[= ]+"?([a-z]+)/.exec(line)?.[1];
			out.push({verb: m[1], phase, line: line.trim()});
		}
	}
	return out;
}

function isAgentCommand(c: DorflCommand): boolean {
	return (
		AGENT_SPAWNING_VERBS.has(c.verb) &&
		!SINGLE_JOB_WARNING_EXEMPT_VERBS.has(c.verb)
	);
}

/** Every `secrets.<NAME>` a job references (in any value). */
function secretsOf(job: Job): Set<string> {
	const text = JSON.stringify(job);
	const out = new Set<string>();
	for (const m of text.matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
		out.add(m[1]);
	}
	return out;
}

/** A GitHub-hosted runner label (`ubuntu-latest`, `windows-2022`, ...). */
function isHostedLabel(runsOn: unknown): boolean {
	return (
		typeof runsOn === 'string' &&
		/^(ubuntu|windows|macos)-[A-Za-z0-9.-]+$/.test(runsOn)
	);
}

const ITEM_WORKFLOW_RE = /(^|\/)dorfl-item(-dispatch)?\.ya?ml$/;

function parseDoc<T>(content: string): T {
	return (parse(content) ?? {}) as T;
}

/** Run the guard over `files`. */
export function guardWorkflows(
	files: readonly GuardFile[],
	options: GuardOptions,
): GuardViolation[] {
	const byPath = new Map(files.map((f) => [f.path, f.content]));
	const out: GuardViolation[] = [];

	/** The steps of a local composite action `./.github/actions/<x>`. */
	const localActionSteps = (uses: string): Step[] => {
		const rel = uses.replace(/^\.\/\.github\//, '').replace(/\/$/, '');
		for (const name of ['action.yml', 'action.yaml']) {
			const content = byPath.get(`${rel}/${name}`);
			if (content !== undefined) {
				const doc = parseDoc<{runs?: {steps?: Step[]}}>(content);
				return doc.runs?.steps ?? [];
			}
		}
		return [];
	};

	const checkJob = (
		file: string,
		label: string,
		job: Job,
		perms: Perms,
		inMatrix: boolean,
	): void => {
		const push = (rule: GuardViolation['rule'], detail: string): void => {
			out.push({file, job: label, rule, detail});
		};
		const steps = job.steps ?? [];
		const persist = steps.some((s) => isCheckout(s) && persistsCredentials(s));
		const commands = steps.flatMap((s) =>
			typeof s.run === 'string' ? dorflCommands(s.run) : [],
		);
		const agentCommands = commands.filter(isAgentCommand);
		const phases = new Set(
			commands.map((c) => c.phase).filter((p) => p !== undefined),
		);

		for (const c of agentCommands) {
			if (c.phase === 'lock' || c.phase === 'apply') continue;
			if (anyWrite(perms) || persist) {
				push(
					'agent-verb-in-write-job',
					`\`dorfl ${c.verb}\`${c.phase ? ` --phase ${c.phase}` : ''} runs in a job ` +
						(anyWrite(perms)
							? `whose token can write (${Object.entries(perms)
									.filter(([, l]) => l === 'write')
									.map(([s]) => s)
									.join(', ')})`
							: 'whose checkout persists credentials'),
				);
			}
		}
		const secrets = secretsOf(job);
		if (phases.has('lock') || phases.has('apply')) {
			for (const s of secrets) {
				if (options.providerKeys.has(s)) {
					push('provider-key-in-write-phase', `references secrets.${s}`);
				}
			}
		}
		if (phases.has('agent')) {
			for (const s of secrets) {
				if (!options.providerKeys.has(s) && s !== 'GITHUB_TOKEN') {
					push('agent-job-foreign-secret', `references secrets.${s}`);
				}
			}
		}
		if (inMatrix && agentCommands.length > 0) {
			push(
				'agent-in-matrix',
				`a matrix job runs \`dorfl ${agentCommands[0].verb}\``,
			);
		}
		const visit = (list: Step[], prefix: string, depth: number): void => {
			list.forEach((step, i) => {
				const where = `${prefix}steps[${i}]`;
				const reason = cacheRestoreReason(step);
				if (reason) push('cache-restore', `${where}: ${reason}`);
				if (
					depth < 5 &&
					typeof step.uses === 'string' &&
					step.uses.startsWith('./.github/actions/')
				) {
					visit(
						localActionSteps(step.uses),
						`${where} -> ${step.uses}: `,
						depth + 1,
					);
				}
			});
		};
		visit(steps, '', 0);
		if (
			perms.actions === 'write' &&
			steps.some((s) => isCheckout(s) || isSetup(s))
		) {
			push(
				'actions-write-with-code',
				'holds actions: write and has a checkout or setup step',
			);
		}
		if (phases.size > 0 && !isHostedLabel(job['runs-on'])) {
			push(
				'phase-job-not-hosted',
				`runs-on ${JSON.stringify(job['runs-on'])} is not a GitHub-hosted label`,
			);
		}
	};

	const walkWorkflow = (
		file: string,
		grant: Perms | undefined,
		labelPrefix: string,
		depth: number,
	): void => {
		const content = byPath.get(file);
		if (content === undefined) return;
		const wf = parseDoc<Workflow>(content);
		if (
			depth === 0 &&
			ITEM_WORKFLOW_RE.test(file) &&
			/dorfl-item\.ya?ml$/.test(file) &&
			wf.concurrency !== undefined
		) {
			out.push({
				file,
				job: '(workflow)',
				rule: 'item-workflow-concurrency',
				detail: 'dorfl-item.yml declares a workflow-level concurrency',
			});
		}
		for (const [jobId, job] of Object.entries(wf.jobs ?? {})) {
			if (job === null || typeof job !== 'object') continue;
			const label = `${labelPrefix}${jobId}`;
			const requestedRaw =
				'permissions' in job ? job.permissions : wf.permissions;
			let perms: Perms;
			if (grant === undefined) {
				perms = resolvePermissions(requestedRaw);
			} else if (requestedRaw === undefined) {
				perms = grant; // a called job without permissions inherits its caller's
			} else {
				const requested = resolvePermissions(requestedRaw);
				for (const [scope, level] of Object.entries(requested)) {
					if (RANK[level] > RANK[grant[scope] ?? 'none']) {
						out.push({
							file,
							job: label,
							rule: 'caller-does-not-grant',
							detail: `requests ${scope}: ${level}, its caller grants ${grant[scope] ?? 'none'}`,
						});
					}
				}
				perms = cap(requested, grant);
			}
			const inMatrix =
				job.strategy !== undefined &&
				job.strategy !== null &&
				(job.strategy as {matrix?: unknown}).matrix !== undefined;
			if (typeof job.uses === 'string') {
				if (inMatrix && ITEM_WORKFLOW_RE.test(job.uses)) {
					out.push({
						file,
						job: label,
						rule: 'agent-in-matrix',
						detail: `a matrix job calls ${job.uses}`,
					});
				}
				if (job.uses.startsWith('./.github/workflows/') && depth < 4) {
					const called = job.uses
						.replace(/^\.\/\.github\//, '')
						.replace(/@.*$/, '');
					walkWorkflow(called, perms, `${label} -> ${called}:`, depth + 1);
				}
				continue;
			}
			checkJob(file, label, job, perms, inMatrix);
		}
	};

	for (const f of files) {
		if (/^workflows\/[^/]+\.ya?ml$/.test(f.path)) {
			walkWorkflow(f.path, undefined, '', 0);
		}
	}
	return out;
}
