import type {Config} from './config.js';
import {resolveRepoConfig} from './repo-config.js';
import {scan, type ScanReport} from './scan.js';
import {selectCandidates, type Candidate} from './select.js';
import {performClaim} from './claim-cas.js';
import {updateJobRecord} from './workspace.js';
import {ledgerWrite} from './ledger-write.js';
import {
	jobWorktreeStrategy,
	type IsolatedTree,
	type IsolationStrategy,
} from './isolation.js';
import {NullHarness, type Harness} from './harness.js';
import {createHarness} from './pi-harness.js';
import {resolveSlice, buildAgentPrompt, PromptError} from './prompt.js';
import {git, gitMv} from './git.js';
import {
	Integrator,
	type ReviewProvider,
	type IntegrateResult,
} from './integrator.js';
import {selectProvider} from './github.js';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/** What happened to one selected item across the whole pipeline. */
export type ItemStatus =
	| 'claimed-done' // tests green + rebased clean → integrated (pushed/merged)
	| 'lost-race' // claim exit 2 — skipped cleanly
	| 'claim-contended' // claim exit 3
	| 'claim-error' // claim exit 1 / unexpected
	| 'tests-failed' // claimed + ran, but gate red → routed to needs-attention
	| 'needs-attention' // rebase conflict at integrate time (ADR §10) — human must look
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
	/** Items routed to needs-attention (rebase conflict, red gate). */
	needsAttention: number;
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
	/**
	 * Pre-computed scan report; if omitted, the working-tree scan is run over the
	 * detected repos (this in-place/roots-based discovery is `run`'s until the
	 * `run-daemon-reframe` slice switches it to the registry's mirror set).
	 */
	report?: ScanReport;
	/**
	 * The execution working area (bare hub mirrors + per-job worktrees). Defaults
	 * to `config.workspacesDir`. STATE, not cache (ADR §3).
	 */
	workspace?: string;
	/**
	 * How to invoke the configured agent. When omitted, the work runs through the
	 * harness seam (null adapter by default) shelling out to `config.agentCmd`.
	 * Tests inject this to edit files directly without a real agent.
	 */
	agentRunner?: AgentRunner;
	/** The harness seam (ADR §5); defaults to the null adapter. */
	harness?: Harness;
	/** How to run the acceptance tests. Defaults to the repo's `pnpm -r test`. */
	testGate?: TestGate;
	/** Review-request provider for `propose` mode (ADR §6); default `none`. */
	provider?: ReviewProvider;
	/** Optional injectable PR opener for `integration: propose` (legacy bridge). */
	openPr?: (opts: {
		cwd: string;
		branch: string;
		env?: NodeJS.ProcessEnv;
	}) => void;
	/** Environment for git/agent child processes. */
	env?: NodeJS.ProcessEnv;
	/** Override agent-id generation (tests). Retained for API compat; unused for branch naming. */
	agentId?: () => string;
	/**
	 * Sink for non-fatal warnings (e.g. a repo's `.agent-runner.json` naming
	 * runner/host-only keys that were ignored). Defaults to a no-op so the core
	 * stays pure; the CLI wires this to stderr.
	 */
	onWarn?: (message: string) => void;
}

/** Default test gate: run the repo's acceptance tests via `pnpm -r test`. */
function defaultTestGate(): TestGate {
	return ({cwd, env}) => {
		const result = runPnpmTest(cwd, env);
		return {
			green: result.green,
			detail: result.green ? undefined : result.detail,
		};
	};
}

function runPnpmTest(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): {green: boolean; detail?: string} {
	const harness = new NullHarness();
	const out = harness.launch({
		dir: cwd,
		slug: '',
		command: 'pnpm -r test',
		env,
	});
	return {green: out.ok, detail: out.detail};
}

/**
 * Run one supervised tick: claim up to `maxParallel` eligible items
 * (≤ `perRepoMax` per repo), run the agent on each in an isolated **job
 * worktree** (the shared execution substrate — hub mirror + worktree + seams),
 * gate on acceptance tests, rebase onto the latest arbiter main, and integrate
 * the green ones. The runner owns EVERY git-state transition (claim, done-move,
 * completion commit, integration); the agent only edits code. A lost race (claim
 * exit 2) is skipped cleanly; failing work never reaches `work/done/`; a rebase
 * conflict is aborted and routed to needs-attention (ADR §10).
 */
export async function runOnce(options: RunOnceOptions): Promise<RunOnceResult> {
	const config = options.config;
	// Default discovery is the REGISTRY (the hub-mirror set, ADR §1). `run` today
	// operates on WORKING CHECKOUTS, so the CLI / its tests inject an explicit
	// `report` built from working-tree paths ({@link scanRepoPaths}); wiring `run`'s
	// own tick to the mirror set is the `run-daemon-reframe` slice. Without an
	// injected report we fall back to the registry scan (async).
	const report = options.report ?? (await scan(config));
	const candidates = selectCandidates(report, {
		maxParallel: config.maxParallel,
		perRepoMax: config.perRepoMax,
	});

	const testGate = options.testGate ?? defaultTestGate();
	// The launch harness: an explicit injection wins (tests); otherwise build the
	// adapter the config selects (`harness: 'pi'` ⇒ the pi CLI; default ⇒ null,
	// shelling out to `agentCmd`). pi specifics stay behind the seam.
	const harness =
		options.harness ??
		createHarness({harness: config.harness, piBin: config.piBin});
	// An explicitly-injected provider (tests / embedding) wins over per-item
	// auto-detection; otherwise each item selects its own provider from its
	// arbiter URL + the resolved per-repo `provider` override (see runOneItem).
	const provider = options.provider;
	const workspace = options.workspace ?? config.workspacesDir;
	const env = options.env;

	const items: ItemResult[] = [];
	for (const candidate of candidates) {
		items.push(
			await runOneItem(candidate, {
				config,
				workspace,
				agentRunner: options.agentRunner,
				harness,
				testGate,
				provider,
				openPr: options.openPr,
				env,
				onWarn: options.onWarn,
			}),
		);
	}

	const claimedAndDone = items.filter(
		(i) => i.status === 'claimed-done',
	).length;
	const skipped = items.filter(
		(i) => i.status === 'lost-race' || i.status === 'claim-contended',
	).length;
	const needsAttention = items.filter(
		(i) => i.status === 'tests-failed' || i.status === 'needs-attention',
	).length;
	const failed = items.filter(
		(i) =>
			i.status === 'tests-failed' ||
			i.status === 'needs-attention' ||
			i.status === 'agent-failed' ||
			i.status === 'claim-error',
	).length;

	return {claimedAndDone, skipped, failed, needsAttention, items};
}

interface OneItemContext {
	config: Config;
	workspace: string;
	agentRunner?: AgentRunner;
	harness: Harness;
	testGate: TestGate;
	/** An explicitly-injected provider that overrides per-item auto-detection. */
	provider?: ReviewProvider;
	openPr?: (opts: {
		cwd: string;
		branch: string;
		env?: NodeJS.ProcessEnv;
	}) => void;
	env?: NodeJS.ProcessEnv;
	onWarn?: (message: string) => void;
}

/**
 * Commit the completed work + the done-move as ONE atomic commit, using the
 * work-contract message format. The runner authors this deterministically (the
 * agent never commits).
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

async function runOneItem(
	candidate: Candidate,
	ctx: OneItemContext,
): Promise<ItemResult> {
	const {slug, repoPath} = candidate;
	const base: ItemResult = {repoPath, slug, status: 'lost-race'};

	// Resolve THIS repo's effective config against its own `.agent-runner.json`
	// layered over the global config (flag > per-repo > global > default). Each
	// repo gets its own integration mode / arbiter, so repo A can be `merge`
	// while repo B is `propose` in one tick.
	const resolved = resolveRepoConfig({repoPath, global: ctx.config});
	const config = resolved.config;
	if (resolved.message) {
		ctx.onWarn?.(resolved.message);
	}

	// 1. Claim (the runner's first git-state transition) via the in-process CAS.
	//    `performClaim` is async, so two awaited runners over the same slug
	//    genuinely race — the arbiter's ref-CAS (not ordering) picks one winner.
	const claim = await performClaim({
		slug,
		cwd: repoPath,
		arbiter: config.defaultArbiter,
		env: ctx.env,
	});
	if (claim.outcome === 'lost') {
		return {...base, status: 'lost-race'};
	}
	if (claim.outcome === 'contended') {
		return {...base, status: 'claim-contended'};
	}
	if (claim.outcome === 'usage-error') {
		return {...base, status: 'claim-error', detail: claim.message};
	}

	// 2. Isolate via the isolation-strategy seam (ADR §3). `run` always selects
	//    the JOB-WORKTREE strategy: materialise the hub mirror + cut a per-job
	//    worktree off the freshly-fetched `<hub>/main` in the agents' area
	//    (ADR §1/§2). The seam yields a UNIFORM HANDLE (dir/branch/arbiterRemote/
	//    arbiterUrl + a strategy-appropriate teardown) that the post-claim pipeline
	//    below reads from — never a concrete `Job` — so the SAME steps serve the
	//    in-place strategy too (wired by `do-in-place`). The mirror is keyed off
	//    the arbiter URL resolved from this repo, so jobs reuse it (fetch, not
	//    re-clone) across the run.
	const strategy: IsolationStrategy = jobWorktreeStrategy({
		fromRepo: repoPath,
		arbiter: config.defaultArbiter,
		workspacesDir: ctx.workspace,
	});
	let tree: IsolatedTree | undefined;
	try {
		tree = strategy.prepare({slug, env: ctx.env});

		// 3. Build the prompt — the SAME dual-use assembly `agent-runner prompt`
		//    emits: the canonical wrapper (+ source PRD) + the slice's ## Prompt.
		let prompt: string;
		try {
			const slice = resolveSlice(tree.dir, slug);
			prompt = buildAgentPrompt(slice.slug, slice.prd, slice.slicePrompt);
		} catch (err) {
			if (err instanceof PromptError) {
				return {...base, status: 'agent-failed', detail: err.message};
			}
			throw err;
		}

		// 4. Run the agent — via the injected runner (tests) or the harness seam
		//    (null adapter by default), shelling out to the configured agentCmd. The
		//    resolved per-repo `model` (ADR §13) flows through the seam to the adapter;
		//    a `{model}`-in-agentCmd misconfiguration surfaces as agent-failed.
		let agent: {ok: boolean; detail?: string};
		try {
			agent = runAgent(ctx, tree, prompt, slug, config.agentCmd, config.model);
		} catch (err) {
			return {...base, status: 'agent-failed', detail: (err as Error).message};
		}
		if (!agent.ok) {
			return {...base, status: 'agent-failed', detail: agent.detail};
		}

		// 5. Test-gate: only green work proceeds. Bad work is routed to
		//    needs-attention (it never auto-merges; the worktree is the signal).
		const gate = ctx.testGate({cwd: tree.dir, slug, env: ctx.env});
		if (!gate.green) {
			const reason = gate.detail ?? 'acceptance gate failed';
			updateJobRecord(tree.dir, {state: 'needs-attention', reason});
			// Folder-native surfacing (ADR §12): bounce the work item itself from
			// in-progress/ to needs-attention/ (saving the aborted work as a wip
			// commit + the move-only commit on the work branch) THROUGH the ledger
			// write seam's needs-attention transition, and SURFACE the stuck state on
			// the arbiter's main (the mode-M strategy cherry-picks the move-only commit
			// there). Passing the arbiter both pushes the work branch (saving the wip
			// cross-machine) and makes the stuck state observable to scan/status/a
			// fresh checkout/another machine. This is a LEDGER write, so it happens in
			// both merge and propose (the integration axis governs CODE only). The
			// runner owns this move (the agent does no git).
			ledgerWrite.applyNeedsAttentionTransition({
				cwd: tree.dir,
				slug,
				reason,
				arbiter: tree.arbiterRemote,
				env: ctx.env,
			});
			return {...base, status: 'tests-failed', detail: gate.detail};
		}

		// 6. Done-move (mkdir -p then git mv) + completion commit — runner-owned.
		gitMv(`work/in-progress/${slug}.md`, `work/done/${slug}.md`, tree.dir);
		commitCompletion(tree.dir, slug, ctx.env);

		// 7. Rebase-before-integrate (ADR §10) then integrate per mode. A
		//    conflicting rebase is aborted + routed to needs-attention (never
		//    auto-resolved); integration never --forces.
		//
		// Provider selection (ADR §6, `propose` mode): an injected `openPr` wins
		// (the legacy test bridge); otherwise pick by the per-repo `provider`
		// override LAYERED OVER auto-detection from the ARBITER URL (a GitHub
		// remote ⇒ the `gh` provider). We key detection off the handle's resolved
		// arbiter URL (`tree.arbiterUrl` — the mirror's arbiter URL for the
		// job-worktree strategy), not the in-worktree remote NAME. If `gh` is
		// absent/unauthenticated the GitHub provider degrades to push-only at
		// runtime — never a hard failure (the branch is already pushed).
		const provider = ctx.openPr
			? bridgeProvider(ctx.openPr)
			: (ctx.provider ??
				selectProvider({
					arbiterUrl: tree.arbiterUrl,
					provider: config.provider,
				}));
		const integratorForItem = new Integrator({provider});
		const outcome = integratorForItem.integrateWithRebase({
			cwd: tree.dir,
			// The arbiter remote name valid inside the isolated tree (job-worktree:
			// the mirror's clone remote `origin`; in-place: the checkout's arbiter
			// remote), NOT the source repo's `defaultArbiter` name.
			arbiter: tree.arbiterRemote,
			branch: tree.branch,
			mode: config.integration,
			env: ctx.env,
		});
		if (outcome.outcome === 'needs-attention') {
			const reason = outcome.reason ?? 'needs attention';
			updateJobRecord(tree.dir, {state: 'needs-attention', reason});
			// Rebase conflict at integrate time (ADR §10): the item was already
			// done-moved + committed at step 6, so route it from done/ to
			// needs-attention/ — the same folder-native surfacing, dispatched through
			// the ledger write seam's needs-attention transition, surfacing the stuck
			// state on the arbiter's main (mode M). Only the MOVE-ONLY commit is
			// cherry-picked to main, so the conflicting code never lands there.
			ledgerWrite.applyNeedsAttentionTransition({
				cwd: tree.dir,
				slug,
				reason,
				arbiter: tree.arbiterRemote,
				env: ctx.env,
			});
			return {...base, status: 'needs-attention', detail: outcome.reason};
		}

		// Record the PR/MR URL on the job (surfaced by `status`) when a provider
		// opened one (propose + a real provider that reported a URL).
		const prUrl = outcome.integration?.url;
		updateJobRecord(tree.dir, {state: 'done', prUrl});
		return {...base, status: 'claimed-done', integration: outcome.integration};
	} finally {
		// Strategy-appropriate teardown via the uniform handle (ADR §4). Job-worktree:
		// re-apply the provably-safe deletion predicate and remove the worktree ONLY
		// if it holds (clean tree AND the branch tip reachable on the arbiter — merged
		// or pushed). One rule, no done-vs-failed special-casing: a claimed-done job
		// is on the arbiter → reaped; a tests-failed / needs-attention / un-pushed job
		// is NOT → retained (the worktree is the needs-attention signal; `gc` catches
		// up). In-place: a NO-OP (the checkout is never reaped). NEVER `--force` here.
		if (tree) {
			tree.teardown();
		}
	}
}

/**
 * Run the agent against the isolated tree. Prefers the injected `agentRunner`
 * (tests / custom embeddings); otherwise launches `agentCmd` through the harness
 * seam (recording the PID in the job's harness block, when there is one).
 */
function runAgent(
	ctx: OneItemContext,
	tree: IsolatedTree,
	prompt: string,
	slug: string,
	agentCmd: string,
	model: string | undefined,
): {ok: boolean; detail?: string} {
	if (ctx.agentRunner) {
		return ctx.agentRunner({cwd: tree.dir, prompt, slug, env: ctx.env});
	}
	const launched = ctx.harness.launch({
		dir: tree.dir,
		slug,
		command: agentCmd,
		prompt,
		// The model routing intent (ADR §13) — the adapter decides HOW it reaches
		// its tool (pi: `--model`; null/shell: `{model}` placeholder).
		model,
		env: ctx.env,
	});
	updateJobRecord(tree.dir, {harness: launched.record});
	return {ok: launched.ok, detail: launched.detail};
}

/** Adapt the legacy `openPr` callback into the new ReviewProvider seam. */
function bridgeProvider(
	openPr: (opts: {
		cwd: string;
		branch: string;
		env?: NodeJS.ProcessEnv;
	}) => void,
): ReviewProvider {
	return {
		name: 'none',
		openRequest(input) {
			openPr({cwd: input.cwd, branch: input.branch, env: input.env});
			return {
				opened: true,
				instruction: `Opened a review for ${input.branch}.`,
			};
		},
	};
}

/** A throwaway default workspace under the OS temp dir (CLI convenience). */
export function defaultRunWorkspace(): string {
	return join(tmpdir(), 'agent-runner-workspace');
}
