import {existsSync} from 'node:fs';
import {join} from 'node:path';
import type {VerifyConfig} from './verify.js';
import type {ReviewGate} from './review-gate.js';
import {
	performIntegration,
	IntegrationNothingStaged,
	synthesiseProposeTitle,
	composeProposeBody,
	PR_TITLE_MAX,
} from './integration-core.js';
import {ledgerWrite} from './ledger-write.js';
import {workBranchRef, parseWorkBranchRef} from './slug-namespace.js';
import type {ReviewProvider} from './integrator.js';
import type {IntegrationMode} from './config.js';
import {runAsync, localMainAheadCount, type RunResult} from './git.js';
import {formatProposeNextStep, shouldUseColor} from './output.js';

// Re-export the propose-mode title/body helpers from their new home (the shared
// integration core) so existing importers (`test/propose-pr-body.test.ts`) keep
// working unchanged after the gate→integrate band moved out of this file.
export {synthesiseProposeTitle, composeProposeBody, PR_TITLE_MAX};

/**
 * `agent-runner complete [<slug>] [--skip-verify] [--type <t>] [--message <s>]
 * [--arbiter <remote>]` — the human "finish this" command that runs the same
 * back-half the autonomous runner runs: gate → mark done → commit → integrate.
 *
 * It runs on a `work/<slug>` branch (slug inferred from the branch if omitted).
 * The build agent leaves its work UNCOMMITTED (it does no git), so `complete`
 * `git add -A`s the agent's work AND the done-move into ONE atomic commit. This
 * is the same finish/integration logic `run-once`/`watch` reuse; here it is
 * human-driven and so allows a `--skip-verify` escape hatch the autonomous
 * runner never uses (ADR §8).
 *
 * The item's SOURCE folder is normally `work/in-progress/` (a freshly-built
 * slice). As a RUNNER-OWNED RECOVERY path it ALSO accepts an item in
 * `work/needs-attention/` (a SPURIOUSLY-failed slice — an env-polluted gate, a
 * transient flake, or a since-fixed cause): when `in-progress/` is absent it
 * falls back to `needs-attention/`, RE-RUNS the gate (authoritative — only a
 * GREEN re-gate completes; a still-red item simply stays in needs-attention/),
 * and on green does the `needs-attention → done` move + commit + rebase +
 * integrate — the SAME machinery, just a different source folder, so a
 * good-but-stuck item is finishable with NO manual git. That recovery rebase
 * also RECONCILES the cherry-picked on-`main` needs-attention surfacing (the
 * done-move supersedes it) so the human never hits a rebase conflict against the
 * surfacing commit. `--skip-verify` stays the only, human-only, loud override.
 *
 * The integration step is split by mode (config `integration`, ADR §6):
 *   merge   — push the rebased branch to `<arbiter>/main`, then sync the LOCAL
 *             clone to that new main (the push is authoritative; the local sync
 *             is the ergonomic finish so the user ends on an up-to-date main).
 *   propose — push the `work/<slug>` branch (the safety-bearing step) and report
 *             the next step. Full provider-driven PR/MR creation lands with the
 *             integration seam; until then `complete` pushes + tells the human.
 *
 * In BOTH modes `complete` lands the human back on local `main` by default
 * ("finish, ready for the next thing") — but the move differs because the work's
 * location differs: `merge` switches to `main` AND fast-forwards it to the just-
 * pushed `<arbiter>/main` (the work landed there); `propose` ONLY `git switch
 * main` (arbiter main has not moved, so there is nothing to ff). `--no-switch`
 * opts out in either mode (stay on `work/<slug>` to keep iterating).
 *
 * After landing on `main`, the LOCAL `work/<slug>` branch is deleted iff its work
 * is provably on the arbiter (the SAME predicate as worktree deletion, ADR §4,
 * mode-agnostic): its tip is an ancestor of `<arbiter>/main` (merged) OR
 * `<arbiter>/work/<slug>` exists with its tip == the local tip (pushed & up-to-
 * date). Otherwise the branch is KEPT (unmerged / unpushed / a diverged un-pushed
 * amend = not safe). The REMOTE branch is NEVER deleted (a propose PR is built
 * from it). `--no-switch` keeps the branch too.
 *
 * Before integrating, the work branch is rebased onto the latest `<arbiter>/main`
 * (ADR §10): a clean rebase continues; a conflicting rebase is `--abort`ed and
 * surfaced as needs-attention — `complete` NEVER auto-resolves. It NEVER
 * `--force`es to main.
 *
 * Exit codes:
 *   0  completed (done-move + commit + integrate succeeded)
 *   1  usage/environment error, or a refusal (gate failed, nothing to commit,
 *      not on a work branch, rebase conflict needs the human)
 *
 * On the two FAILURE paths the human can't paper over — a red gate (without
 * `--skip-verify`) and a rebase conflict (ADR §10) — `complete` no longer leaves
 * the item dangling. Instead it routes the item through the shared
 * `needs-attention` mechanism (ADR §12): record the reason and
 * `git mv work/in-progress|done/<slug>.md → work/needs-attention/<slug>.md`, so
 * the stuck item is surfaced by `status` and returnable to `backlog/`. The
 * success and `--skip-verify` paths are unchanged. The exit code stays 1 (the
 * work did NOT complete); the outcome still names WHY (gate-failed /
 * rebase-conflict) and `routedToNeedsAttention` records that the move happened.
 */

export type CompleteOutcome =
	| 'completed' // gated, moved, committed, integrated
	| 'already-integrated' // stranded-done auto-recover: tip already on <arbiter>/main → clean no-op (no re-push, no double-integrate)
	| 'prepare-failed' // the env-prep step (prepare) was red — env not ready, verify not run
	| 'gate-failed' // the acceptance gate was red (and not skipped)
	| 'review-blocked' // Gate 2 (PR/code review) returned `block` (or exhausted rounds)
	| 'rebase-conflict' // rebase onto arbiter/main conflicted (aborted; human resolves)
	| 'invariant-violation' // one-slug-one-folder would break (slug in two folders on the arbiter)
	| 'refused' // nothing to complete (nothing to commit, wrong folder, …)
	| 'usage-error'; // usage / environment problem

export interface CompleteOptions {
	/** The slug to complete. If omitted, inferred from a `work/<slug>` branch. */
	slug?: string;
	/** The working clone/checkout the work branch lives in. */
	cwd: string;
	/** Name of the arbiter git remote. Defaults to `origin`. */
	arbiter?: string;
	/** Integration mode: `propose` (default) or `merge`. */
	integration?: IntegrationMode;
	/**
	 * **The explicit `--merge` override** for the untrusted-origin build-propose rule
	 * (slice `untrusted-origin-forces-build-propose`). `true` iff the operator
	 * EXPLICITLY typed `--merge` on this invocation (vs `merge` resolved from
	 * config). Forwarded to {@link performIntegration}'s `explicitMerge`: an explicit
	 * `--merge` OVERRIDES the untrusted-origin build-propose rule (the operator is
	 * present; CLI always wins). Unset on the autonomous path ⇒ an untrusted-origin
	 * slice reliably forces `propose`.
	 */
	explicitMerge?: boolean;
	/**
	 * Override the pre-flight DIVERGENCE guard (`--ignore-diverged-main`, mirroring
	 * `--ignore-not-ready`): proceed even when local `main` is ahead of
	 * `<arbiter>/main` (has unpushed commits). MERGE MODE ONLY (only merge mode ff's
	 * local `main`). When overridden and the divergence persists, the now-NON-FATAL
	 * {@link syncLocalMain} reports it honestly (work on the arbiter; local `main`
	 * left to rebase). Loud, never the default.
	 */
	ignoreDivergedMain?: boolean;
	/**
	 * Leave the human ON the `work/<slug>` branch (and KEEP it) in either mode,
	 * instead of switching back to `main` + deleting the provably-landed branch.
	 * For "I'll keep iterating on this branch" (e.g. addressing review feedback).
	 */
	noSwitch?: boolean;
	/** The declared per-repo ENV-PREP step (string | list), run ONCE before the
	 * first `verify` to make the env ready. Unset ⇒ a no-op (NO default install). */
	prepare?: VerifyConfig;
	/** The declared per-repo gate (string | list). Unset ⇒ the default command. */
	verify?: VerifyConfig;
	/**
	 * Run the acceptance gate (`prepare` then `verify`) against the REBASED tip
	 * in a CLEAN throwaway worktree (the tree that integrates) when `true` (the
	 * default), rather than the current checkout (the pre-rebase tree) when
	 * `false`. `complete` is a SINGLE-JOB path, so this is the resolved flag
	 * passed UNCONDITIONALLY (no `run`-fleet downgrade). Forwarded verbatim to
	 * {@link performIntegration}.
	 */
	freshWorktreeGate?: boolean;
	/** Skip the acceptance gate (human-only escape hatch; never used unattended). */
	skipVerify?: boolean;
	/**
	 * **Gate 2 — the PR/code review gate** (GATES PRD `work/prd/review.md`). When
	 * `true`, after the green `verify` and BEFORE the done-move, run the `review`
	 * SKILL as a FRESH-CONTEXT agent (its own harness launch) and route its verdict:
	 * `approve` → proceed to done-move/commit/integrate; `block` → route to
	 * needs-attention (NEVER merge). `verify` is the non-skippable floor; review is
	 * a JUDGEMENT gate ON TOP (ADR §8), never a replacement. Default OFF.
	 */
	review?: boolean;
	/**
	 * The model the REVIEW agent runs on (de-correlation from the builder). Flows
	 * to the review-agent launch through the EXISTING harness seam
	 * (`LaunchInput.model` / `substituteModel`). Unset ⇒ no forced review model.
	 */
	reviewModel?: string;
	/**
	 * Bound the revise↔review loop (Gate 2). On exhaustion the gate ERRORS OUT and
	 * forces needs-attention (never silently merges or loops). Defaults to 2.
	 */
	reviewMaxRounds?: number;
	/**
	 * The review-gate SEAM (injectable, like `do`'s `agentRunner`): a fresh-context
	 * review that returns a parsed `{verdict, findings}`. Tests inject a canned
	 * verdict (no real model); production wires the harness-backed gate
	 * (`harnessReviewGate`). Required when `review` is on (a missing gate with
	 * `review` on is a usage error — the floor must not be silently skipped).
	 */
	reviewGate?: ReviewGate;
	/**
	 * `--watch`: tail the Gate-2 REVIEW agent's pi session `.jsonl` live, the SAME
	 * way `do --watch` tails the build agent's (slice `watch-review-session`).
	 * Threaded into the `reviewGate` invocation below so the production gate
	 * (`harnessReviewGate`) routes its launch through the shared
	 * `launchWithOptionalWatch` helper. OFF (the default) ⇒ the review path is
	 * byte-for-byte unchanged (sync launch, no tailer). Observability only — it
	 * never changes the verdict/routing.
	 */
	watch?: boolean;
	/** Where the tailed review lines are written (defaults to stderr). */
	watchSink?: (line: string) => void;
	/**
	 * The HOST-ONLY sessions root the review session FILE is generated under
	 * (resolved `config.sessionsDir`). Threaded to the review-agent launch so its
	 * (distinct `<slug>-review`) session lands under the same root as the build's.
	 */
	sessionsDir?: string;
	/** Conventional-commit type for the completion commit. Defaults to `feat`. */
	type?: string;
	/** Commit summary. Defaults to the slice `title` minus a leading `slug — `. */
	message?: string;
	/**
	 * Optional review-request BODY (propose mode) — the PR/MR DESCRIPTION, DISTINCT
	 * from {@link message} (which is the COMMIT summary). Advisory prose that gates
	 * nothing. The autonomous `do` path passes the build agent's final summary
	 * (`LaunchResult.output`); a human `complete --propose` may pass one via a NEW
	 * `--body` flag (NOT `--message`). The runner scaffolds a deterministic header
	 * (a pointer to `work/done/<slug>.md`) above it. Absent ⇒ today's `gh pr create
	 * --fill` empty/commit-derived body (no regression). Ignored in `merge` mode.
	 */
	body?: string;
	/** Optional injectable PR opener (e.g. `gh pr create`); used in `propose` mode. */
	openPr?: (opts: {
		cwd: string;
		branch: string;
		env?: NodeJS.ProcessEnv;
	}) => void;
	/**
	 * Optional FULLY-FORMED review provider INSTANCE used VERBATIM (the SAME seam
	 * `run` exposes via `RunOptions.provider`; forwarded to `performIntegration` as
	 * `providerInstance`). Tests/embeddings inject a stubbed `GitHubProvider` (a
	 * custom `gh` path) to drive the full propose pipeline OFFLINE without a real
	 * GitHub arbiter. This is the resolved provider OBJECT — NOT a config override
	 * (there is none; the provider is purely arbiter-derived). Unset ⇒ the core
	 * selects the provider from the arbiter URL as normal.
	 */
	providerInstance?: ReviewProvider;
	/**
	 * **The PR-INTENT axis** (config `noPR`, ADR §6). When `true` on the propose
	 * path, push the branch but SKIP the review request (the explicit suppress-PR
	 * intent, re-homing the old `provider: none` use). NOT a provider choice — the
	 * provider is purely arbiter-derived. Threaded verbatim into
	 * {@link performIntegration}. Ignored in `merge` mode and when `openPr` is
	 * injected. Unset/false ⇒ propose opens the PR via the arbiter-derived provider.
	 */
	noPR?: boolean;
	/**
	 * Surface a needs-attention bounce ON THE ARBITER (the AUTONOMOUS variant of
	 * the failure path). When set, the two FAILURE routings (`gate-failed` /
	 * `rebase-conflict`) pass this arbiter remote into the ledger write seam's
	 * `applyNeedsAttentionTransition`, which (mode M) cherry-picks the move-only
	 * commit onto the arbiter's `main` — making the stuck state observable to
	 * `scan`/`status`/another machine. This is exactly what `run`'s `runOneItem`
	 * does (it passes `arbiter: job.arbiterRemote`).
	 *
	 * Unset (the default) keeps `complete`'s HUMAN behaviour: route LOCALLY only
	 * (no on-`main` surfacing) — a human is right there, so no cross-machine
	 * surfacing is needed. The unattended `do` worker (the CI command) sets this
	 * so a stuck CI run is NOT invisible.
	 */
	surfaceArbiter?: string;
	/** Environment for child git/provider processes (the identity-scoped env). */
	env?: NodeJS.ProcessEnv;
	/**
	 * Environment for the REVIEW-AGENT launch (Gate 2) — the AMBIENT env, never the
	 * identity-scoped {@link env} (an agent must not act as the bot). Threaded to
	 * {@link performIntegration}'s `agentEnv`. Unset ⇒ falls back to {@link env}
	 * (byte-for-byte unchanged for non-identity callers, e.g. the human `complete`).
	 */
	agentEnv?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
	/**
	 * Sink for a pre-formatted block printed VERBATIM (no `>> ` prefix), used for
	 * the visually-distinct propose-mode next-step block so its blank lines and
	 * heading stand out cleanly. Defaults to `note` when not supplied.
	 */
	noteBlock?: (message: string) => void;
	/**
	 * Emit ANSI color in the (cosmetic) propose-mode next-step block. Defaults
	 * to the TTY/`NO_COLOR` rule against `process.stdout`; injectable so tests
	 * can simulate a TTY (color) vs. a pipe / `NO_COLOR` (plain) without a real
	 * terminal. Color-only — it changes no gate/done-move/commit/integrate logic.
	 */
	color?: boolean;
}

export interface CompleteResult {
	exitCode: 0 | 1;
	outcome: CompleteOutcome;
	/**
	 * True iff a FAILURE outcome (gate-failed / rebase-conflict) was routed to
	 * `work/needs-attention/` via the shared mechanism (ADR §12), rather than left
	 * dangling. Undefined/false on the success, `--skip-verify`, refused, and
	 * usage-error paths (none of which move the item to needs-attention).
	 */
	routedToNeedsAttention?: boolean;
	/** The work branch that was completed, when one was resolved. */
	branch?: string;
	/** The completion commit message that was authored, on success. */
	commitMessage?: string;
	/** True when the work landed on the arbiter's `main` (merge mode). */
	mergedToMain?: boolean;
	/**
	 * Merge mode only: whether the LOCAL `main` was fast-forwarded to the
	 * just-pushed `<arbiter>/main` (the ergonomic courtesy AFTER the authoritative
	 * push). `true` on the normal ff path; `false` when local `main` had DIVERGED
	 * and the ff could not apply — a NON-FATAL skip (the arbiter push already
	 * defined success, so `outcome` stays `completed` / exit 0; the operator is told
	 * to `git rebase` to sync). Undefined outside merge mode / `--no-switch`.
	 */
	localMainSynced?: boolean;
	/** The branch HEAD ended on after completing (`main`, or the work branch). */
	switchedTo?: string;
	/** True iff the local `work/<slug>` branch was deleted (provably on arbiter). */
	deletedLocalBranch?: boolean;
	/**
	 * The review-request URL (e.g. a GitHub PR) opened in `propose` mode, when a
	 * provider opened one and reported it (ADR §6). Absent in merge mode and on
	 * the push-only / degraded path.
	 */
	prUrl?: string;
	/** Human-readable summary of the terminal condition. */
	message: string;
}

const DEFAULT_ARBITER = 'origin';
const DEFAULT_INTEGRATION: IntegrationMode = 'propose';

/**
 * Resolve the integration mode the human asked for ON THIS invocation from the
 * mutually-exclusive `--merge` / `--propose` flags. Returns the explicit mode,
 * or `undefined` when neither flag was given (per-repo > global > default then
 * decides). Throws when BOTH are given (they are mutually exclusive). This is
 * the TOP of the complete-time precedence chain (flag > per-repo > global >
 * default); the autonomous runner uses no flag and so resolves the same
 * underlying order.
 */
export function integrationFromFlags(flags: {
	merge?: boolean;
	propose?: boolean;
}): IntegrationMode | undefined {
	if (flags.merge && flags.propose) {
		throw new Error(
			'--merge and --propose are mutually exclusive; pass at most one.',
		);
	}
	if (flags.merge) {
		return 'merge';
	}
	if (flags.propose) {
		return 'propose';
	}
	return undefined;
}

/** Raised for usage/environment errors (exit 1, outcome 'usage-error'). */
class CompleteUsageError extends Error {}

/** Raised for a deliberate REFUSAL (exit 1, outcome 'refused'). */
class CompleteRefusal extends Error {}

/**
 * Run the complete ritual. Never throws for the expected gate-failed /
 * rebase-conflict / refused cases — those are returned with exit 1 and a
 * specific outcome. Usage/environment problems also surface as exit 1.
 */
export async function performComplete(
	options: CompleteOptions,
): Promise<CompleteResult> {
	const note = options.note ?? (() => {});
	try {
		return await runComplete(options, note);
	} catch (err) {
		if (
			err instanceof CompleteRefusal ||
			err instanceof IntegrationNothingStaged
		) {
			// `IntegrationNothingStaged` is the core's empty-commit refusal — the same
			// `refused` outcome the inline band raised before the extraction.
			return {exitCode: 1, outcome: 'refused', message: err.message};
		}
		if (err instanceof CompleteUsageError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}
}

async function runComplete(
	options: CompleteOptions,
	note: (m: string) => void,
): Promise<CompleteResult> {
	const cwd = options.cwd;
	const env = options.env;
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	// The integration mode. The shared core integrates a `merge` automatically on a
	// green gate (and an `approve` when review is on) and leaves a `propose` to a
	// human; there is no downgrade, so the mode it resolves always equals this one.
	// The tail below still reads the resolved mode from `core.integration.mode`.
	const requestedMode = options.integration ?? DEFAULT_INTEGRATION;

	if ((await gitSoft(['rev-parse', '--git-dir'], cwd, env)).status !== 0) {
		throw new CompleteUsageError('not inside a git repository');
	}
	if ((await gitSoft(['remote', 'get-url', arbiter], cwd, env)).status !== 0) {
		throw new CompleteUsageError(
			`no git remote named '${arbiter}' (set one, or pass --arbiter)`,
		);
	}

	// Resolve the slug + work branch. `complete` runs ON the work branch (it
	// rebases + pushes it), and the branch carries the namespaced `work/<type>-
	// <slug>` identity. So PREFER the branch HEAD is on (recovering BOTH the type
	// and the slug from it); only when an explicit slug is given AND HEAD is not on
	// a work branch do we synthesise the slice-namespaced branch (`complete` is a
	// slice command).
	const headBranch = await currentBranch(cwd, env);
	const headParsed = parseWorkBranchRef(headBranch);
	const slug = options.slug || headParsed?.slug || '';
	if (!slug) {
		throw new CompleteUsageError(
			'missing <slug> and the current branch is not a work/<type>-<slug> ' +
				'branch. usage: agent-runner complete [<slug>] [--skip-verify] ' +
				'[--type t] [--message s] [--arbiter remote]',
		);
	}
	// The branch HEAD is on when it IS a work branch for this slug (so an explicit
	// `prd:`-style recovery still completes the branch it is standing on); else
	// synthesise the slice branch.
	const branch =
		headParsed && headParsed.slug === slug
			? headBranch
			: workBranchRef('slice', slug);

	// We must be ON the work branch — that is where the agent's work lives and
	// what we rebase + push. (Unlike `start`, `complete` mutates the checkout.)
	const head = headBranch;
	if (head !== branch) {
		throw new CompleteUsageError(
			`not on ${branch} (HEAD is '${head}'). ` +
				`Check out the work branch before completing '${slug}'.`,
		);
	}

	// The slice must be in-progress in the working tree (the normal path), OR —
	// the runner-owned recovery path — in needs-attention/ (a SPURIOUSLY-failed
	// item the human/runner is finishing: the gate failure was env-pollution / a
	// transient flake / a since-fixed cause). We prefer in-progress/; we fall back
	// to needs-attention/ ONLY when in-progress/ is absent. Refuse only when
	// NEITHER folder holds it. From needs-attention/ the gate is RE-RUN and must be
	// GREEN to complete (recovery never trusts the human blindly — the existing
	// human-only --skip-verify stays the loud override); the surfaced on-`main`
	// needs-attention state is reconciled by the done-move (it supersedes it).
	//
	// This LOCAL source resolution is now only a PRE-FLIGHT (which folder the
	// checkout holds + the `recovering` re-gate decision) and the content FALLBACK:
	// the integration core's done-move RESOLVES THE ACTUAL SOURCE FOLDER FROM THE
	// ARBITER (arbiter-is-truth) and removes it from THERE, so the move can never
	// disagree with what the arbiter holds even when the local tree diverges
	// (ledger-integrity defect 1). The `source` we pass is the arbiter-content
	// fallback for the degenerate "arbiter holds nothing" case, not the authority.
	const inProgress = join(cwd, 'work', 'in-progress', `${slug}.md`);
	const needsAttention = join(cwd, 'work', 'needs-attention', `${slug}.md`);
	const done = join(cwd, 'work', 'done', `${slug}.md`);
	const onInProgress = existsSync(inProgress);
	const onNeedsAttention = existsSync(needsAttention);
	const onDone = existsSync(done);
	// STRANDED-DONE AUTO-RECOVER (PRD `ledger-integrity` story 6, the autonomous
	// half of `finish-already-committed-branch`). When neither in-progress/ nor
	// needs-attention/ holds the slug on the BRANCH tree BUT done/ does, the work
	// branch was already built + done-moved + committed by a prior run that never
	// landed on the arbiter (a terminal push failed, or the PR never merged). The
	// autonomous `do`/`advance`/plain-`complete` path used to refuse this with
	// `nothing to complete`; instead route into the SHARED recover tail (the SAME
	// `committedRecovery: true` path `complete --isolated` drives), reusing the
	// existing capability. Detection here is the FRONT-GATE only — folder shape;
	// `recoverAlreadyCommitted` owns the unspoofable tip-vs-arbiter `isAncestor`
	// decision (one reachability check, not two), so a tip ALREADY on
	// `<arbiter>/main` returns `already-integrated` (clean no-op, NEVER a
	// re-push/double-integrate). Mutually exclusive with the build-path source +
	// `recovering` flags — the core ignores them when `committedRecovery` is set.
	const committedRecovery = !onInProgress && !onNeedsAttention && onDone;
	const source: 'in-progress' | 'needs-attention' = onInProgress
		? 'in-progress'
		: 'needs-attention';
	const sourcePath = source === 'in-progress' ? inProgress : needsAttention;
	if (!committedRecovery && !existsSync(sourcePath)) {
		throw new CompleteRefusal(
			`work/in-progress/${slug}.md (nor work/needs-attention/${slug}.md) found — ` +
				'nothing to complete (already done, or wrong slug?).',
		);
	}
	const recovering = !committedRecovery && source === 'needs-attention';
	if (committedRecovery) {
		// Announce LOUDLY: a stranded already-complete branch signals an EARLIER
		// un-merged PR — the CI/job log must record that the autonomous path took
		// the recovery branch, not a normal completion. The `already-integrated`
		// no-op gets its own clear note from the core itself.
		note(
			`>> recovered a stranded already-complete branch for '${slug}' — ` +
				'integrating the kept commit (no rebuild). This signals an earlier ' +
				'un-merged PR.',
		);
	}

	// Pre-flight DIVERGENCE GUARD (merge mode only) — the SAME class of refusal `do`
	// raises up front: a local `main` AHEAD of `<arbiter>/main` (unpushed commits)
	// cannot be fast-forwarded by the merge-back, so refuse BEFORE the gate so no
	// work is wasted. Only merge mode ff's local `main`; propose only switches to it
	// (no ff), so the guard is irrelevant there. `--ignore-diverged-main` overrides
	// (mirrors `--ignore-not-ready`); when overridden, the now-NON-FATAL
	// `syncLocalMain` handles the persisting divergence honestly at integrate-time.
	if (requestedMode === 'merge' && options.ignoreDivergedMain !== true) {
		await gitHard(['fetch', '--quiet', arbiter], cwd, env);
		const ahead = await localMainAheadCount(cwd, arbiter, env);
		if (ahead > 0) {
			throw new CompleteRefusal(
				`local main is ahead of ${arbiter}/main by ${ahead} commit` +
					`${ahead === 1 ? '' : 's'} (unpushed); a merge completion ff's local ` +
					"main, which can't fast-forward against a diverged main — push or " +
					'reconcile main first (or re-run with --ignore-diverged-main to ' +
					'proceed anyway).',
			);
		}
	}

	// CORE: run the SHARED gate→integrate band (verify → review → effective-mode
	// decision → done-move → commit → rebase → integrate → needs-attention routing).
	// It returns DATA (the routing + the effective-mode decision already happened
	// inside it); the TAIL below does only `complete`'s caller-specific post-step
	// (switch-to-main / ff / delete-branch / `--no-switch` / the propose next-step
	// block). The human-vs-autonomous difference rides on `surfaceArbiter` (DATA).
	// `IntegrationNothingStaged` is the one refusal the core raises (empty commit);
	// `performComplete`'s try/catch maps it to `refused`, unchanged.
	const core = await performIntegration({
		cwd,
		arbiter,
		slug,
		// The namespaced work branch HEAD is on (resolved above) — pass it through
		// so the integrate core pushes the EXACT branch, not a re-synthesised default.
		branch,
		source,
		recovering,
		// Route stranded-done into the shared recover tail (front-gate detection;
		// the core does the unspoofable tip-vs-arbiter ancestry check).
		committedRecovery,
		prepare: options.prepare,
		verify: options.verify,
		freshWorktreeGate: options.freshWorktreeGate,
		skipVerify: options.skipVerify,
		// The untrusted-origin build-propose rule's override (slice
		// `untrusted-origin-forces-build-propose`): an explicit `--merge` lets the
		// operator land an untrusted-origin slice on main; the autonomous path leaves
		// it unset so untrusted-origin reliably forces propose.
		explicitMerge: options.explicitMerge,
		review: options.review,
		reviewGate: options.reviewGate,
		reviewModel: options.reviewModel,
		reviewMaxRounds: options.reviewMaxRounds,
		mode: requestedMode,
		noPR: options.noPR,
		providerInstance: options.providerInstance,
		openPr: options.openPr,
		body: options.body,
		type: options.type,
		message: options.message,
		surfaceArbiter: options.surfaceArbiter,
		watch: options.watch,
		watchSink: options.watchSink,
		color: options.color,
		sessionsDir: options.sessionsDir,
		env,
		agentEnv: options.agentEnv,
		note,
	});

	// The FAILURE outcomes map 1:1 onto `complete`'s — the core already note()'d
	// the reason and did any routing; the tail never runs for them.
	if (core.outcome === 'prepare-failed') {
		return {
			exitCode: 1,
			outcome: 'prepare-failed',
			routedToNeedsAttention: core.routedToNeedsAttention,
			branch: core.branch,
			message: core.reason ?? '',
		};
	}
	if (core.outcome === 'gate-failed') {
		return {
			exitCode: 1,
			outcome: 'gate-failed',
			routedToNeedsAttention: core.routedToNeedsAttention,
			branch: core.branch,
			message: core.reason ?? '',
		};
	}
	if (core.outcome === 'review-blocked') {
		return {
			exitCode: 1,
			outcome: 'review-blocked',
			routedToNeedsAttention: core.routedToNeedsAttention,
			branch: core.branch,
			message: core.reason ?? '',
		};
	}
	if (core.outcome === 'rebase-conflict') {
		return {
			exitCode: 1,
			outcome: 'rebase-conflict',
			routedToNeedsAttention: core.routedToNeedsAttention,
			branch: core.branch,
			commitMessage: core.commitMessage,
			message: core.reason ?? '',
		};
	}
	if (core.outcome === 'already-integrated') {
		// Stranded-done auto-recover: the kept tip is ALREADY on `<arbiter>/main`
		// (the PR merged out-of-band before the re-run). A clean, successful no-op
		// — NEVER a re-push / second PR. The core already emitted its honest note;
		// the caller's tail (switch-to-main / ff / delete-branch) is irrelevant
		// because the work is already integrated and the branch may or may not
		// still exist locally.
		return {
			exitCode: 0,
			outcome: 'already-integrated',
			branch: core.branch,
			message: core.reason ?? '',
		};
	}
	if (core.outcome === 'invariant-violation') {
		// The one-slug-one-folder guard FAILED LOUD: the arbiter already holds the
		// slug in >1 status folder (a corrupt ledger). Nothing was committed/moved;
		// refuse rather than publish corruption (the human resolves the duplicate —
		// `scan`/`gc` surfaces it — then re-runs). Exit 1, never routed.
		return {
			exitCode: 1,
			outcome: 'invariant-violation',
			routedToNeedsAttention: false,
			branch: core.branch,
			message: core.reason ?? '',
		};
	}

	// SUCCESS: the core integrated. `result` is its integration result; `mode` is
	// the mode the core resolved, read from the result (it always equals the
	// requested mode now that there is no downgrade). The tail switches/ffs per the
	// mode that integrated.
	const result = core.integration!;
	const commitMessage = core.commitMessage;
	const mode = result.mode;

	// Land back on `main` by default in BOTH modes (the move differs per mode),
	// then delete the local work branch iff its work is provably on the arbiter.
	// `--no-switch` keeps the human on the work branch AND keeps the branch.
	let switchedTo = branch;
	let deletedLocalBranch = false;
	// Merge mode only: whether the local `main` ff'd (the courtesy after the
	// authoritative push). `true` by default; flipped to `false` by `syncLocalMain`
	// on a NON-FATAL diverged-`main` skip. Undefined in propose / `--no-switch`.
	let localMainSynced: boolean | undefined;
	if (!options.noSwitch) {
		if (mode === 'merge') {
			// merge: the work landed on <arbiter>/main, so switch to main AND ff it.
			// The ff is a COURTESY — if local `main` diverged it cannot apply, which is
			// NON-FATAL (the push already defined success); `syncLocalMain` reports it.
			localMainSynced = await syncLocalMain(cwd, arbiter, env, note);
		} else {
			// propose: the work is on a pushed branch awaiting review, NOT on main,
			// so JUST switch to main — do NOT ff (arbiter main has not moved).
			await gitHard(['switch', '--quiet', 'main'], cwd, env);
		}
		switchedTo = 'main';
		// Delete the LOCAL work branch when provably on the arbiter (same predicate
		// as worktree deletion, ADR §4, mode-agnostic). NEVER delete the remote.
		deletedLocalBranch = await deleteLocalBranchIfProvablyOnArbiter(
			cwd,
			arbiter,
			branch,
			env,
		);
	}

	if (mode === 'merge') {
		// When the local ff was SKIPPED (diverged main, non-fatal), say so honestly —
		// the work IS on the arbiter; only the local courtesy ff was left undone.
		const localState =
			localMainSynced === false
				? 'local main left diverged (run `git rebase origin/main` to sync)'
				: 'local main updated';
		const landed = options.noSwitch
			? `merged to ${arbiter}/main; left on ${branch} (--no-switch).`
			: `merged to ${arbiter}/main; ${localState}` +
				`${deletedLocalBranch ? ` and ${branch} deleted` : ''}.`;
		const message = `Completed '${slug}': ${landed}`;
		note(message);
		return {
			exitCode: 0,
			outcome: 'completed',
			branch,
			commitMessage,
			mergedToMain: result.mergedToMain,
			localMainSynced,
			switchedTo,
			deletedLocalBranch,
			message,
		};
	}

	// propose: the branch is pushed; report the next step. The next step is the
	// ONE thing the human must act on, so it is emitted as a visually-distinct
	// block (blank lines + heading + TTY-aware color) ON TOP of the plain summary
	// note below — cosmetic only; the structured result is unchanged.
	const color = options.color ?? shouldUseColor(process.stdout);
	const noteBlock = options.noteBlock ?? note;
	noteBlock(
		formatProposeNextStep({
			branch,
			arbiter,
			requestOpened: result.requestOpened,
			color,
		}),
	);
	const next = result.requestOpened
		? result.url
			? `pushed ${branch} and opened a review (${result.url})`
			: `pushed ${branch} and opened a review`
		: `pushed ${branch} to ${arbiter}. ` + 'Open a PR/MR to land it on main';
	const tail = options.noSwitch
		? `; left on ${branch} (--no-switch).`
		: deletedLocalBranch
			? `; switched to main and deleted ${branch}.`
			: '; switched to main.';
	const message = `Completed '${slug}': ${next}${tail}`;
	note(message);
	return {
		exitCode: 0,
		outcome: 'completed',
		branch,
		commitMessage,
		mergedToMain: false,
		switchedTo,
		deletedLocalBranch,
		prUrl: result.url,
		message,
	};
}

/**
 * Sync the local `main` to the just-pushed `<arbiter>/main`: switch to main and
 * fast-forward it. We fetch the arbiter's main (we just pushed our rebased work
 * there) then `merge --ff-only` so the user lands on an up-to-date local main
 * without merge noise.
 *
 * The ff is a COURTESY, NOT the safety-bearing step — the authoritative push to
 * `<arbiter>/main` already defined `complete`'s success. So the ff is NON-FATAL:
 * if local `main` has DIVERGED (unpushed commits the arbiter lacks) the ff cannot
 * apply; rather than throw (which would make `complete` exit non-zero even though
 * the merge ALREADY LANDED on the arbiter), we print a clear "rebase to sync"
 * message and return `false` (the caller records `localMainSynced: false` and
 * keeps `outcome: completed` / exit 0). Returns `true` on a normal ff.
 *
 * Only the diverged / ff-cannot-apply case is softened — the `fetch` and `switch`
 * stay `gitHard` (a genuinely different failure is NOT masked, per the slice).
 * Exported for direct testing of the softened-vs-fatal boundary in isolation.
 */
export async function syncLocalMain(
	cwd: string,
	arbiter: string,
	env: NodeJS.ProcessEnv | undefined,
	note: (m: string) => void,
): Promise<boolean> {
	await gitHard(['fetch', '--quiet', arbiter], cwd, env);
	await gitHard(['switch', '--quiet', 'main'], cwd, env);
	// SOFT: a non-zero here is (almost always) "not possible to fast-forward" —
	// local `main` diverged. That is the one case we make non-fatal.
	const ff = await gitSoft(
		['merge', '--ff-only', '--quiet', `${arbiter}/main`],
		cwd,
		env,
	);
	if (ff.status === 0) {
		return true;
	}
	note(
		`work landed on ${arbiter}/main; your local main couldn't fast-forward (it ` +
			'has diverged) — run `git rebase origin/main` to sync.',
	);
	return false;
}

/**
 * Delete the LOCAL `work/<slug>` branch iff its work is PROVABLY on the arbiter
 * — the SAME predicate as worktree deletion (ADR §4), mode-agnostic. Must be
 * called AFTER we have switched off the branch (you cannot delete the branch you
 * are on). Returns whether the local branch was deleted.
 *
 * Provably-on-arbiter ⇔ EITHER:
 *   - merged: the branch tip is an ancestor of `<arbiter>/main`, OR
 *   - pushed & up-to-date: `<arbiter>/<branch>` exists AND its tip == the local
 *     branch tip (so a later un-pushed amend is NEVER lost — we verify the
 *     remote tip equals the local tip, not merely that "a branch was pushed").
 *
 * Otherwise the branch is KEPT (unmerged / unpushed / diverged = not safe). The
 * REMOTE branch is NEVER touched (a propose PR is built from it). A `git fetch`
 * refreshes the remote-tracking refs so reachability is read against the LIVE
 * arbiter; an unreachable arbiter simply reads as not-provable → keep (safe).
 */
async function deleteLocalBranchIfProvablyOnArbiter(
	cwd: string,
	arbiter: string,
	branch: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
	if (!(await isLocalBranchProvablyOnArbiter(cwd, arbiter, branch, env))) {
		return false; // not provably on the arbiter → KEEP the local branch
	}
	// Provably on the arbiter → delete ONLY the local branch (force-delete: the
	// `-d` safety check uses the upstream/HEAD, which we have already proven via
	// the predicate above; `-D` avoids a false "not fully merged" in propose mode).
	await gitHard(['branch', '-D', branch], cwd, env);
	return true;
}

/**
 * The provably-safe predicate (ADR §4), mode-agnostic, applied to a LOCAL
 * `branch` in `cwd`: true iff its tip is an ancestor of `<arbiter>/main` (merged)
 * OR `<arbiter>/<branch>` exists with its tip == the local tip (pushed &
 * up-to-date). False when the local branch is absent, or its work is unmerged /
 * unpushed / a diverged un-pushed amend (remote tip != local tip). A `git fetch`
 * refreshes the remote-tracking refs; an unreachable arbiter reads as not-
 * provable → false (the safe direction). Exported for direct testing of the
 * kept-vs-deleted decision in isolation.
 */
export async function isLocalBranchProvablyOnArbiter(
	cwd: string,
	arbiter: string,
	branch: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
	const localTip = (
		await gitSoft(['rev-parse', '--verify', '--quiet', branch], cwd, env)
	).stdout.trim();
	if (localTip === '') {
		return false; // no such local branch
	}

	// Refresh remote-tracking refs against the live arbiter (best-effort).
	await gitSoft(['fetch', '--quiet', arbiter], cwd, env);

	// Merged: tip is an ancestor of <arbiter>/main.
	const merged =
		(
			await gitSoft(
				['merge-base', '--is-ancestor', localTip, `${arbiter}/main`],
				cwd,
				env,
			)
		).status === 0;
	if (merged) {
		return true;
	}

	// Pushed & up-to-date: <arbiter>/<branch> exists AND its tip == the local tip
	// (we verify remote-tip == local-tip so a later un-pushed amend is never lost).
	const remoteTip = (
		await gitSoft(
			['rev-parse', '--verify', '--quiet', `refs/remotes/${arbiter}/${branch}`],
			cwd,
			env,
		)
	).stdout.trim();
	return remoteTip !== '' && remoteTip === localTip;
}

/** The short symbolic name of HEAD, or '' for a detached HEAD. */
async function currentBranch(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
	const sym = await gitSoft(
		['symbolic-ref', '--quiet', '--short', 'HEAD'],
		cwd,
		env,
	);
	return sym.status === 0 ? sym.stdout.trim() : '';
}

/** Run git, returning the raw result (no throw) — for soft checks. */
function gitSoft(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<RunResult> {
	return runAsync('git', args, cwd, {env});
}

/** Run git; throw on non-zero (genuinely unexpected plumbing failures). */
async function gitHard(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<RunResult> {
	const result = await runAsync('git', args, cwd, {env});
	if (result.status !== 0) {
		throw new Error(
			`git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr.trim()}`,
		);
	}
	return result;
}
