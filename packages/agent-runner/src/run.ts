import {randomBytes} from 'node:crypto';
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import type {Config} from './config.js';
import {scan, type ScanReport} from './scan.js';
import {selectCandidates, type Candidate} from './select.js';
import {claimItem} from './claim.js';
import {isolate, type IsolationMode, type IsolationHandle} from './isolate.js';
import {extractPromptSection, buildAgentPrompt} from './prompt.js';
import {run as runCmd, git, gitMv} from './git.js';
import {integrate, type IntegrateResult} from './integrate.js';

/** What happened to one selected item across the whole pipeline. */
export type ItemStatus =
	| 'claimed-done' // tests green → moved to work/done/ + integrated
	| 'lost-race' // claim.sh exit 2 — skipped cleanly
	| 'claim-contended' // claim.sh exit 3
	| 'claim-error' // claim.sh exit 1 / unexpected
	| 'tests-failed' // claimed + ran, but gate red → left in-progress / needs-attention
	| 'agent-failed'; // agentCmd itself errored before the gate

export interface ItemResult {
	repoPath: string;
	slug: string;
	status: ItemStatus;
	/** Integration outcome, when the item reached done. */
	integration?: IntegrateResult;
	detail?: string;
}

export interface RunOnceResult {
	claimedAndDone: number;
	skipped: number;
	failed: number;
	items: ItemResult[];
}

/** The agent invocation: edits code in `cwd` to satisfy the prompt. */
export type AgentRunner = (input: {
	cwd: string;
	prompt: string;
	slug: string;
	env?: NodeJS.ProcessEnv;
}) => {ok: boolean; detail?: string};

/** The acceptance-test gate: green ⇒ true. */
export type TestGate = (input: {
	cwd: string;
	slug: string;
	env?: NodeJS.ProcessEnv;
}) => {green: boolean; detail?: string};

export interface RunOnceOptions {
	config: Config;
	/** Pre-computed scan report; if omitted, the scan core is run from config. */
	report?: ScanReport;
	/** Workspace root for isolated clones/worktrees. */
	workspace: string;
	/** Isolation strategy; clones are preferred for parallelism. */
	isolation?: IsolationMode;
	/** How to invoke the configured agent. Defaults to shelling out to agentCmd. */
	agentRunner?: AgentRunner;
	/** How to run the acceptance tests. Defaults to the repo's `pnpm -r test`. */
	testGate?: TestGate;
	/** Optional injectable PR opener for `integration: propose`. */
	openPr?: (opts: {
		cwd: string;
		branch: string;
		env?: NodeJS.ProcessEnv;
	}) => void;
	/** Environment for git/agent child processes. */
	env?: NodeJS.ProcessEnv;
	/** Path to claim.sh (defaults to the vendored copy). */
	claimScript?: string;
	/** Override agent-id generation (tests). */
	agentId?: () => string;
}

/** Default agent runner: shell out to `config.agentCmd`, prompt on stdin. */
function defaultAgentRunner(agentCmd: string): AgentRunner {
	return ({cwd, prompt, env}) => {
		const result = runCmd('bash', ['-c', agentCmd], cwd, {input: prompt, env});
		return {
			ok: result.status === 0,
			detail: result.status === 0 ? undefined : result.stderr.trim(),
		};
	};
}

/** Default test gate: run the repo's acceptance tests via `pnpm -r test`. */
function defaultTestGate(): TestGate {
	return ({cwd, env}) => {
		const result = runCmd('pnpm', ['-r', 'test'], cwd, {env});
		return {
			green: result.status === 0,
			detail: result.status === 0 ? undefined : result.stderr.trim(),
		};
	};
}

function shortId(): string {
	return randomBytes(3).toString('hex');
}

/** Read the slice's `## Prompt` body from `work/in-progress/<slug>.md` in `dir`. */
function readSlicePrompt(dir: string, slug: string): string | undefined {
	const path = join(dir, 'work', 'in-progress', `${slug}.md`);
	if (!existsSync(path)) {
		return undefined;
	}
	return extractPromptSection(readFileSync(path, 'utf8'));
}

/**
 * Commit the completed work + the done-move as ONE atomic commit, using the
 * work-contract message format `<type>(<slug>): <summary>; done`. The runner
 * authors this deterministically (the agent never commits).
 */
function commitCompletion(
	dir: string,
	slug: string,
	env: NodeJS.ProcessEnv | undefined,
): void {
	git(['add', '-A'], dir, {env});
	const message = `feat(${slug}): complete work slice; done`;
	git(['commit', '-q', '-m', message], dir, {env});
}

/**
 * Run one supervised tick (increment B): claim up to `maxParallel` eligible
 * items (≤ `perRepoMax` per repo), run the agent on each in isolation, gate on
 * acceptance tests, and integrate the green ones. The runner owns EVERY
 * git-state transition (claim, done-move, completion commit, integration); the
 * agent only edits code. A lost race (claim exit 2) is skipped cleanly; failing
 * work never reaches `work/done/`.
 */
export function runOnce(options: RunOnceOptions): RunOnceResult {
	const config = options.config;
	const report = options.report ?? scan(config);
	const candidates = selectCandidates(report, {
		maxParallel: config.maxParallel,
		perRepoMax: config.perRepoMax,
	});

	const agentRunner =
		options.agentRunner ?? defaultAgentRunner(config.agentCmd);
	const testGate = options.testGate ?? defaultTestGate();
	const newId = options.agentId ?? shortId;
	const env = options.env;

	const items: ItemResult[] = [];
	for (const candidate of candidates) {
		items.push(
			runOneItem(candidate, {
				config,
				workspace: options.workspace,
				isolation: options.isolation ?? 'clone',
				agentRunner,
				testGate,
				openPr: options.openPr,
				env,
				claimScript: options.claimScript,
				agentId: newId(),
			}),
		);
	}

	const claimedAndDone = items.filter(
		(i) => i.status === 'claimed-done',
	).length;
	const skipped = items.filter(
		(i) => i.status === 'lost-race' || i.status === 'claim-contended',
	).length;
	const failed = items.filter(
		(i) =>
			i.status === 'tests-failed' ||
			i.status === 'agent-failed' ||
			i.status === 'claim-error',
	).length;

	return {claimedAndDone, skipped, failed, items};
}

interface OneItemContext {
	config: Config;
	workspace: string;
	isolation: IsolationMode;
	agentRunner: AgentRunner;
	testGate: TestGate;
	openPr?: (opts: {
		cwd: string;
		branch: string;
		env?: NodeJS.ProcessEnv;
	}) => void;
	env?: NodeJS.ProcessEnv;
	claimScript?: string;
	agentId: string;
}

function runOneItem(candidate: Candidate, ctx: OneItemContext): ItemResult {
	const {slug, repoPath} = candidate;
	const base: ItemResult = {repoPath, slug, status: 'lost-race'};

	// 1. Claim (the runner's first git-state transition) via claim.sh.
	const claim = claimItem({
		slug,
		cwd: repoPath,
		arbiter: ctx.config.defaultArbiter,
		claimScript: ctx.claimScript,
		env: ctx.env,
	});
	if (claim.outcome === 'lost') {
		return {...base, status: 'lost-race'};
	}
	if (claim.outcome === 'contended') {
		return {...base, status: 'claim-contended'};
	}
	if (claim.outcome === 'error') {
		return {...base, status: 'claim-error', detail: claim.stderr.trim()};
	}

	// 2. Isolate in its own clone/worktree cut from the freshly-claimed main.
	let handle: IsolationHandle | undefined;
	try {
		handle = isolate({
			sourceRepo: repoPath,
			arbiter: ctx.config.defaultArbiter,
			slug,
			agentId: ctx.agentId,
			workspace: ctx.workspace,
			mode: ctx.isolation,
			env: ctx.env,
		});

		// 3. Build the prompt (constant wrapper + slice ## Prompt) and run the agent.
		const slicePrompt = readSlicePrompt(handle.dir, slug) ?? '';
		const prompt = buildAgentPrompt(slug, slicePrompt);
		const agent = ctx.agentRunner({
			cwd: handle.dir,
			prompt,
			slug,
			env: ctx.env,
		});
		if (!agent.ok) {
			return {...base, status: 'agent-failed', detail: agent.detail};
		}

		// 4. Test-gate: only green work proceeds to done + integration.
		const gate = ctx.testGate({cwd: handle.dir, slug, env: ctx.env});
		if (!gate.green) {
			// Bad work never auto-merges; it stays in work/in-progress/ for the human.
			return {...base, status: 'tests-failed', detail: gate.detail};
		}

		// 5. Done-move (mkdir -p then git mv) + completion commit — runner-owned.
		gitMv(`work/in-progress/${slug}.md`, `work/done/${slug}.md`, handle.dir);
		commitCompletion(handle.dir, slug, ctx.env);

		// 6. Integrate per config (propose by default; merge where allowed). Never --force.
		const integration = integrate({
			cwd: handle.dir,
			arbiter: ctx.config.defaultArbiter,
			branch: handle.branch,
			mode: ctx.config.integration,
			env: ctx.env,
			openPr: ctx.openPr,
		});

		return {...base, status: 'claimed-done', integration};
	} finally {
		handle?.dispose();
	}
}
