import type {Config} from './config.js';
import {resolveRepoConfig} from './repo-config.js';
import {scan, type ScanReport} from './scan.js';
import {selectCandidates, type Candidate} from './select.js';
import {performClaim} from './claim-cas.js';
import {updateJobRecord, encodeWorkId} from './workspace.js';
import {ledgerWrite} from './ledger-write.js';
import {
	jobWorktreeStrategy,
	type IsolatedTree,
	type IsolationStrategy,
} from './isolation.js';
import type {Harness} from './harness.js';
import {createHarness} from './pi-harness.js';
import {generateSessionPath} from './session-path.js';
import {resolveSlice, buildAgentPrompt, PromptError} from './prompt.js';
import {type IntegrateResult, type ReviewProvider} from './integrator.js';
import {performIntegration} from './integration-core.js';
import type {ReviewGate} from './review-gate.js';
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
}) => {
	ok: boolean;
	detail?: string;
	/**
	 * The agent's FINAL SUMMARY (the harness seam's `LaunchResult.output`): the
	 * channel the propose-mode PR BODY is built from (mirrors `do`'s
	 * `DoAgentRunner.output`). Optional so a test agent may supply one; production
	 * surfaces the build agent's last assistant message. Absent ⇒ no body ⇒ the
	 * provider degrades to `--fill` (no regression).
	 */
	output?: string;
};

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
	/**
	 * The PR/code review gate (Gate 2) SEAM, threaded into the shared
	 * `performIntegration` core. Tests inject a canned `approve`/`block` verdict
	 * (no real model); the CLI passes the production `harnessReviewGate()` ONLY
	 * when `config.review` resolves on. Unset ⇒ no review (the default). The core
	 * throws if `review` is on but this is absent — `runOneItem` guards that.
	 */
	reviewGate?: ReviewGate;
	/**
	 * An explicitly-injected, fully-formed review provider that overrides per-item
	 * auto-detection (tests / embedding). Forwarded to `performIntegration` as
	 * `providerInstance` (carrying title/body/url). Unset ⇒ the core selects the
	 * provider from the arbiter URL + the per-repo `provider` override.
	 */
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
				reviewGate: options.reviewGate,
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
	/** The PR/code review gate (Gate 2) seam threaded into `performIntegration`. */
	reviewGate?: ReviewGate;
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

		// 2a. CONTINUE rebase conflict (ADR §14 + §10): a requeue kept a
		//     `work/<slug>` whose commits did not replay cleanly onto the current
		//     main at onboard-time (aborted, never auto-resolved). Route the item to
		//     needs-attention through the seam, which (with the arbiter) surfaces the
		//     stuck state on main AND pushes the work branch — here a no-op/ff: the
		//     rebase was ABORTED, so this worktree's `work/<slug>` tip == the arbiter
		//     tip (the kept branch, unchanged). The DURABLE artifact is that branch on
		//     the arbiter + the main surface (ADR §14: the job worktree is a disposable
		//     cache; recovery flows through the branch + folder-native surfaces, NOT by
		//     editing the worktree). Because the branch is provably on the arbiter, the
		//     §4 reap predicate now HOLDS and this worktree is reaped (not specially
		//     retained) — more §14-aligned, not a regression.
		if (tree.continueRebaseConflict) {
			const reason =
				`continuing the kept work/${slug}: rebase onto the latest main ` +
				'conflicted (aborted, never auto-resolved) — resolve against the latest ' +
				'main, or `requeue --reset` to discard and start fresh';
			updateJobRecord(tree.dir, {state: 'needs-attention', reason});
			ledgerWrite.applyNeedsAttentionTransition({
				cwd: tree.dir,
				slug,
				reason,
				arbiter: tree.arbiterRemote,
				env: ctx.env,
			});
			return {...base, status: 'needs-attention', detail: reason};
		}

		// 3. Build the prompt — the SAME dual-use assembly `agent-runner prompt`
		//    emits: the canonical wrapper (+ source PRD) + the slice's ## Prompt.
		let prompt: string;
		try {
			const slice = resolveSlice(tree.dir, slug);
			prompt = buildAgentPrompt(slice.slug, slice.prd, slice.slicePrompt);
		} catch (err) {
			if (err instanceof PromptError) {
				return saveAgentFailure(base, tree, slug, err.message, ctx.env);
			}
			throw err;
		}

		// 4. Run the agent — via the injected runner (tests) or the harness seam
		//    (null adapter by default), shelling out to the configured agentCmd. The
		//    resolved per-repo `model` (ADR §13) flows through the seam to the adapter;
		//    a `{model}`-in-agentCmd misconfiguration surfaces as agent-failed.
		let agent: {ok: boolean; detail?: string; output?: string};
		try {
			agent = runAgent(
				ctx,
				tree,
				prompt,
				slug,
				config.agentCmd,
				config.model,
				config.sessionsDir,
			);
		} catch (err) {
			return saveAgentFailure(
				base,
				tree,
				slug,
				(err as Error).message,
				ctx.env,
			);
		}
		if (!agent.ok) {
			return saveAgentFailure(
				base,
				tree,
				slug,
				agent.detail ?? `the agent failed to build '${slug}'.`,
				ctx.env,
			);
		}

		// 5–7 (CONVERGED). The whole gate → review → done-move → commit → rebase →
		// integrate band — plus the needs-attention routing on any failure — now runs
		// through the SHARED `performIntegration` core (`integration-core.ts`, the
		// run/do convergence PRD). `run` no longer forks its own gate / done-move /
		// completion commit / `Integrator`+`integrateWithRebase`: that closed all
		// three drift instances at once (the fleet now gets the review gate, the PR
		// title/body, AND the per-repo language-agnostic `verify` gate instead of the
		// old test-only `pnpm -r test` floor). The HEAD above (claim, isolate, agent,
		// failure-save) and the TAIL below (job record + worktree reap) stay here;
		// the band is what they share. `run` is ALWAYS autonomous, so it ALWAYS
		// passes `surfaceArbiter` (every failure surfaces on the arbiter's main +
		// pushes the branch). The injected `openPr` legacy bridge is forwarded to the
		// core unchanged; absent it the core selects the provider from the arbiter
		// URL + the per-repo `provider` override (a GitHub remote ⇒ `gh pr create`).
		//
		// `performIntegration` THROWS a plain `Error` for a misconfigured gate
		// (`review` on with no `reviewGate` wired) — `run`'s CLI always wires one when
		// `config.review` is on, so that is a defensive case, but it must NOT crash
		// the whole tick. We catch it and route the item through the same
		// work-preserving needs-attention seam an agent failure uses (`saveAgentFailure`)
		// so the worktree is handled and the run continues to the next item.
		let core;
		try {
			core = await performIntegration({
				cwd: tree.dir,
				// The arbiter remote name valid inside the isolated tree (job-worktree:
				// the mirror's clone remote `origin`), NOT the source repo's
				// `defaultArbiter` name.
				arbiter: tree.arbiterRemote,
				slug,
				source: 'in-progress',
				recovering: false,
				// `run` is ALWAYS autonomous → surface every failure on the arbiter's
				// main AND push the work branch (DATA, not a caller-identity flag).
				surfaceArbiter: tree.arbiterRemote,
				// The per-repo, language-agnostic gate (ADR §8) — the protocol-conformance
				// fix: `run` now honours `config.verify` instead of the deleted
				// `defaultTestGate`'s hardcoded `pnpm -r test`.
				verify: config.verify,
				// Gate 2 (PR/code review): the per-repo resolved flags ride from `config`;
				// only the gate SEAM is threaded through `ctx` (the CLI wires the prod
				// `harnessReviewGate()` only when `config.review` is on).
				review: config.review,
				autoMerge: config.autoMerge,
				reviewModel: config.reviewModel,
				reviewMaxRounds: config.reviewMaxRounds,
				reviewGate: ctx.reviewGate,
				mode: config.integration,
				// Provider: an injected `openPr` wins (legacy test bridge); otherwise the
				// core selects from the arbiter URL + the per-repo `provider` override
				// (a GitHub remote ⇒ `gh pr create`, else push-only `none`).
				provider: config.provider,
				providerInstance: ctx.provider,
				openPr: ctx.openPr,
				// Half A/B: the synthesised single-line title + the agent's surfaced
				// final summary as the PR body (the core scaffolds the slice-pointer
				// header). `title` is synthesised inside the core from the slice's
				// frontmatter; `body` is the agent output (undefined ⇒ `--fill`).
				body: agent.output,
				env: ctx.env,
			});
		} catch (err) {
			// A thrown core error (misconfigured gate, or an unexpected plumbing
			// failure) — SAVE the work + route to needs-attention, never crash the tick.
			return saveAgentFailure(
				base,
				tree,
				slug,
				(err as Error).message,
				ctx.env,
			);
		}

		// TAIL: map the core's DATA outcome onto the job record + `ItemStatus`. The
		// core already ran the gate/review/move/commit/rebase/integrate AND did the
		// needs-attention routing; `run`'s tail does ONLY the job-record write + (in
		// `finally`) the worktree reap. `run` NEVER switches/ff/deletes branches
		// (that is `do`'s in-place tail; a job worktree is reaped, not switched).
		if (core.outcome === 'gate-failed') {
			updateJobRecord(tree.dir, {
				state: 'needs-attention',
				reason: core.reason,
			});
			return {...base, status: 'tests-failed', detail: core.reason};
		}
		if (
			core.outcome === 'review-blocked' ||
			core.outcome === 'rebase-conflict'
		) {
			updateJobRecord(tree.dir, {
				state: 'needs-attention',
				reason: core.reason,
			});
			return {...base, status: 'needs-attention', detail: core.reason};
		}

		// SUCCESS: the core integrated. Record the PR/MR URL (when a provider opened
		// one) on the job, surfaced by `status`.
		const prUrl = core.integration?.url;
		updateJobRecord(tree.dir, {state: 'done', prUrl});
		return {...base, status: 'claimed-done', integration: core.integration};
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
	sessionsDir: string | undefined,
): {ok: boolean; detail?: string; output?: string} {
	if (ctx.agentRunner) {
		return ctx.agentRunner({cwd: tree.dir, prompt, slug, env: ctx.env});
	}
	// Generate the full pi session-FILE path (slice `session-path-pi-default`):
	// `<sessionsDir>/<work-id>-<unique>.jsonl`, or pi's per-cwd default folder when
	// `sessionsDir` is unset. The work-id (arbiter URL + slug) is `run`'s natural
	// unique-per-claim id. Threaded through the seam so the pi adapter passes
	// `--session <path>` (never `--session-dir` into the worktree).
	const session = generateSessionPath({
		sessionsDir,
		cwd: tree.dir,
		id: encodeWorkId(tree.arbiterUrl, slug),
	});
	const launched = ctx.harness.launch({
		dir: tree.dir,
		slug,
		command: agentCmd,
		prompt,
		// The model routing intent (ADR §13) — the adapter decides HOW it reaches
		// its tool (pi: `--model`; null/shell: `{model}` placeholder).
		model,
		session,
		env: ctx.env,
	});
	updateJobRecord(tree.dir, {harness: launched.record});
	// Surface the agent's FINAL SUMMARY (`LaunchResult.output`) — the source channel
	// for the propose-mode PR body — instead of dropping it (mirrors `do`'s
	// `runDoAgent`). Absent (no parseable assistant text) ⇒ undefined ⇒ `--fill`.
	return {ok: launched.ok, detail: launched.detail, output: launched.output};
}

/**
 * SAVE the partial work of a FAILED agent instead of dropping it (closing the
 * fifth-and-last instance of the recurring asymmetry —
 * `work/observations/run-agent-failure-does-not-save-work.md`). `run`'s
 * agent-failure return points (prompt-assembly fail / `runAgent` throw /
 * `agent.ok === false`) used to BARE-RETURN `agent-failed`, leaving whatever the
 * agent edited only on the LOCAL work branch in the (disposable, possibly remote)
 * job worktree — not on the arbiter, so a requeue-continue on a DIFFERENT machine
 * (or after a `gc` reap) re-cut fresh off main and orphaned it.
 *
 * This mirrors `do.ts`'s `saveAgentFailure`: route the failure through the SAME
 * ledger write seam's needs-attention transition the gate-fail / integrate-
 * conflict bounces use — which (with the arbiter) saves the agent's work as a wip
 * commit, `git mv`s the item to needs-attention/ with the failure detail recorded
 * as the reason, surfaces the move-only commit on the arbiter's `main`
 * (OBSERVABLE), AND pushes the `work/<slug>` branch (RECOVERABLE — the durable
 * artifact a requeue-continue lands the next agent on; continue-detection reads
 * <arbiter>/work/<slug> ahead of main). The push is best-effort — an unreachable
 * arbiter leaves the retained worktree + the local commits standing (the genuinely
 * un-pushed case). The status stays `agent-failed`; only the work-preserving
 * side-effect now matches the gate-fail path.
 */
function saveAgentFailure(
	base: ItemResult,
	tree: IsolatedTree,
	slug: string,
	detail: string,
	env: NodeJS.ProcessEnv | undefined,
): ItemResult {
	const reason = `agent failed: ${detail}`;
	updateJobRecord(tree.dir, {state: 'needs-attention', reason});
	ledgerWrite.applyNeedsAttentionTransition({
		cwd: tree.dir,
		slug,
		reason,
		// Autonomous (`run`): surface on the arbiter's main AND push the work branch
		// (the seam does both now), so the fleet's failed-agent work is cross-machine
		// recoverable via requeue-continue.
		arbiter: tree.arbiterRemote,
		env,
	});
	return {...base, status: 'agent-failed', detail};
}

/** A throwaway default workspace under the OS temp dir (CLI convenience). */
export function defaultRunWorkspace(): string {
	return join(tmpdir(), 'agent-runner-workspace');
}
