import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {runVerify, type VerifyConfig} from './verify.js';
import {
	type ReviewGate,
	type ReviewFinding,
	type ReviewVerdict,
	formatBlockReason,
	reviewRoundsExhaustedReason,
} from './review-gate.js';
import {type IntegrateResult, type ReviewProvider} from './integrator.js';
import {ledgerWrite} from './ledger-write.js';
import {selectProvider} from './github.js';
import type {IntegrationMode, ReviewProviderName} from './config.js';
import {runAsync, type RunResult} from './git.js';

/**
 * **The shared gate→integrate BACK-HALF** of the per-item pipeline, extracted out
 * of `performComplete` (`complete.ts`) so BOTH the human `do`/`complete` path and
 * (a later slice) the autonomous `run` path share ONE implementation of:
 *
 *   verify gate → review gate (Gate 2) → effective-integration-mode decision →
 *   done-move → atomic commit → rebase-onto-arbiter → integrate
 *   (via `ledgerWrite.applyCompleteTransition`) → needs-attention routing on ANY
 *   failure.
 *
 * It is the CORE in the head / core / tail decomposition (PRD
 * `work/prd/run-do-integrate-convergence.md`): the caller-specific HEAD
 * (repo/arbiter/branch checks, source resolution, the `recovering` flag) and TAIL
 * (switch-to-main / `syncLocalMain` / delete-local-branch / `--no-switch` / the
 * propose next-step block, or — for `run` — the job-record + worktree reap) stay
 * in their respective callers; this is the band they share.
 *
 * It returns DATA ({@link IntegrationCoreResult}) and performs the needs-attention
 * ROUTING and the effective-mode DECISION — but NO caller-specific side effects
 * (no `git switch main`, no branch delete, no job record, no propose next-step
 * block). The human-vs-autonomous difference rides entirely on the {@link
 * IntegrationCoreInput.surfaceArbiter} field (human = unset ⇒ local-only routing;
 * autonomous = set ⇒ surface-on-main + push-branch routing) — DATA, never a
 * caller-identity flag.
 *
 * **Slice 1 of the run/do convergence is a PURE REFACTOR.** The band below is
 * byte-for-byte the logic that previously lived inline in `performComplete`,
 * including the current `autoMerge`-off `merge`→`propose` downgrade preserved
 * VERBATIM (the `autoMerge` concept-collision is fenced OUT of this work —
 * `work/findings/automerge-concept-collision-merge-vs-propose.md`). The effective
 * mode the core resolved is carried in {@link IntegrationCoreResult.integration}'s
 * `mode`; the tail reads it from there, NEVER from the requested mode.
 */

/**
 * The outcome the core resolved. These already match `complete`'s
 * `CompleteOutcome` subset the core can produce — the tail maps them 1:1 (it adds
 * only `refused`/`usage-error`, which are HEAD concerns the core never reaches).
 */
export type IntegrationCoreOutcome =
	| 'completed' // gated, reviewed, moved, committed, rebased, integrated
	| 'gate-failed' // the acceptance gate (verify) was red (and not skipped)
	| 'review-blocked' // Gate 2 (PR/code review) returned `block` (or exhausted rounds)
	| 'rebase-conflict'; // rebase onto arbiter/main conflicted (aborted; human resolves)

/**
 * The CORE's input — everything the band needs, nothing caller-shaped. Every
 * divergence between the human `complete` path and the autonomous `do`/`run` path
 * maps to a FIELD VALUE here, not an `if (caller === …)` branch (PRD: "zero
 * caller-identity leakage"). In-place vs worktree = `cwd`; arbiter name =
 * `arbiter`; human vs autonomous surfacing = `surfaceArbiter`; do's recovery =
 * `source` + `recovering`; per-repo/lang gate = `verify`.
 */
/**
 * A NON-SLICE lifecycle the integrate band threads in place of its default,
 * slice-shaped done-move + title source. The shared band
 * (verify→review→commit→rebase→integrate→propose-PR-with-title/body) is
 * IDENTICAL; only the "which item move + which file to read the title from" step
 * is caller-supplied. This is the seam the `do prd:<slug>` SLICING transition
 * rides (slice `slice-output-through-integration`): its "item move" is the PRD
 * LIFECYCLE move (`work/slicing/<slug>.md → work/prd-sliced/<slug>.md`, residence =
 * sliced-ness) plus its EMITTED backlog files — NOT a slice done-move. Supplying it
 * makes every integrate-time arg (`--propose`/`--merge`, provider, title/body)
 * apply to slicing BY CONSTRUCTION, because they resolve ONCE here.
 *
 * When set, the band: (1) reads the PR title / default commit summary from
 * {@link titlePath} instead of `work/<source>/<slug>.md`; (2) calls {@link stage}
 * (runner-owned, on the work branch) instead of the slice `git mv → work/done/`;
 * and (3) uses the PLAIN rebase (a slicing transition never `recover`s a
 * surfaced needs-attention move). Everything else — the `git add -A` that sweeps
 * the agent's uncommitted work + the staged lifecycle move, the atomic commit,
 * the rebase, the integrate, and the propose-mode PR title/body — is shared.
 */
export interface IntegrationLifecycle {
	/**
	 * Absolute path to the item file whose `title:` frontmatter seeds the default
	 * commit summary AND the synthesised propose-mode PR title. For the slicing
	 * transition this is the held PRD (`work/slicing/<slug>.md`) — read BEFORE
	 * {@link stage} moves it.
	 */
	titlePath: string;
	/**
	 * STAGE the lifecycle move + emitted files into the index on the current work
	 * branch (runner-owned git; the agent never does git). For the slicing
	 * transition: `git mv work/slicing/<slug>.md → work/prd-sliced/<slug>.md`
	 * (residence = sliced-ness; no marker), and write+`git add` the produced
	 * `work/backlog/*.md` files. The band's subsequent `git add -A` + atomic commit
	 * folds this staging
	 * AND the agent's uncommitted backlog writes into ONE runner-owned commit. May
	 * be async (it shells git).
	 */
	stage(): Promise<void> | void;
	/**
	 * The trailing transition tag on the runner-owned commit subject
	 * (`<type>(<slug>): <summary>; <commitTag>`). Defaults to `done` (the build
	 * lifecycle); the slicing transition supplies `sliced`. Cosmetic — it names
	 * WHICH lifecycle landed; it gates nothing.
	 */
	commitTag?: string;
}

export interface IntegrationCoreInput {
	/** The working clone/checkout (in-place) OR worktree dir the work branch lives in. */
	cwd: string;
	/** Name of the arbiter git remote (valid in `cwd`). */
	arbiter: string;
	/** The slug being integrated (its work branch is `work/<slug>`). */
	slug: string;
	/**
	 * Which folder the item is being completed FROM: `in-progress` (the normal,
	 * freshly-built path) or `needs-attention` (the runner-owned recovery path).
	 * The HEAD resolved this; the core uses it for the done-move source folder and
	 * the recovery rebase. IGNORED when {@link lifecycle} is set (a non-slice move).
	 */
	source: 'in-progress' | 'needs-attention';
	/**
	 * True iff completing FROM `needs-attention/` (a recovery finish). A red re-gate
	 * here keeps the item in needs-attention/ (no re-route); the rebase drops the
	 * historical needs-attention move-only commit so it does not conflict with the
	 * surfaced state on main.
	 */
	recovering: boolean;
	/** The declared per-repo gate (string | list). Unset ⇒ the default command. */
	verify?: VerifyConfig;
	/** Skip the acceptance gate (human-only escape hatch; never used unattended). */
	skipVerify?: boolean;
	/** Run Gate 2 (the PR/code review gate) after the green `verify`. Default OFF. */
	review?: boolean;
	/** The review-gate SEAM (injectable). Required when `review` is on. */
	reviewGate?: ReviewGate;
	/** On a Gate-2 approve, allow a resolved `merge` to proceed autonomously. */
	autoMerge?: boolean;
	/** The model the REVIEW agent runs on (de-correlated from the builder). */
	reviewModel?: string;
	/** Bound the revise↔review loop (Gate 2). Defaults to 2. */
	reviewMaxRounds?: number;
	/** Integration mode the caller REQUESTED (`propose` default, or `merge`). */
	mode: IntegrationMode;
	/**
	 * The review-request provider override (config `provider`, ADR §6). Unset ⇒
	 * auto-detect from the arbiter URL. Ignored when `openPr` is injected (the
	 * legacy bridge wins). `merge` mode ignores it.
	 */
	provider?: ReviewProviderName;
	/**
	 * Optional FULLY-FORMED review provider to use VERBATIM (highest precedence,
	 * above `openPr` and `provider`/auto-detection). The `run` path injects a
	 * stubbed `GitHubProvider` here in tests (a custom `gh` binary path) to drive
	 * the full propose pipeline incl. title/body/url — which the lossy `openPr`
	 * bridge cannot carry. Unset by `do`/`complete` (they use `provider`/`openPr`),
	 * so their behaviour is unchanged.
	 */
	providerInstance?: ReviewProvider;
	/** Optional injectable PR opener (legacy bridge); used in `propose` mode. */
	openPr?: (opts: {
		cwd: string;
		branch: string;
		env?: NodeJS.ProcessEnv;
	}) => void;
	/**
	 * Optional review-request BODY (propose mode) — advisory prose. The runner
	 * scaffolds a deterministic header (a pointer to `work/done/<slug>.md`) above
	 * it. Absent ⇒ today's `gh pr create --fill` (no regression).
	 */
	body?: string;
	/** Conventional-commit type for the completion commit. Defaults to `feat`. */
	type?: string;
	/** Commit summary. Defaults to the slice `title` minus a leading `slug — `. */
	message?: string;
	/**
	 * Surface a needs-attention bounce ON THE ARBITER (the AUTONOMOUS variant). When
	 * set, the failure routings (`gate-failed` / `review-blocked` / `rebase-conflict`)
	 * pass this arbiter remote into the ledger write seam's
	 * `applyNeedsAttentionTransition` (which cherry-picks the move onto `main` +
	 * pushes the branch — observable + recoverable cross-machine). Unset ⇒ the human
	 * `complete` behaviour: route LOCALLY only.
	 */
	surfaceArbiter?: string;
	/** `--watch`: tail the Gate-2 review agent's session live. Observability only. */
	watch?: boolean;
	/** Where the tailed review lines are written (defaults to stderr). */
	watchSink?: (line: string) => void;
	/** Emit ANSI colour in the tailed review lines (the caller's TTY decision). */
	color?: boolean;
	/** The HOST-ONLY sessions root the review session FILE is generated under. */
	sessionsDir?: string;
	/** Environment for child GIT/provider processes (the identity-scoped env). */
	env?: NodeJS.ProcessEnv;
	/**
	 * Environment for the REVIEW-AGENT launch (Gate 2). Distinct from {@link env}
	 * because the review agent is an AGENT — it must NOT carry the runner identity
	 * (the agent must not act/commit as the bot; only the runner's own git
	 * transitions do). The caller passes the plain AMBIENT env here when an identity
	 * is configured. Unset ⇒ falls back to {@link env} (no identity ⇒ they are the
	 * same env, so this is byte-for-byte unchanged for every non-identity caller).
	 */
	agentEnv?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
	/**
	 * A NON-SLICE lifecycle move + title source (slice
	 * `slice-output-through-integration`). When set, the band reads the title from
	 * its {@link IntegrationLifecycle.titlePath}, calls its
	 * {@link IntegrationLifecycle.stage} INSTEAD of the slice `git mv → work/done/`,
	 * and uses the plain rebase ({@link recovering} is irrelevant). The `do prd:`
	 * SLICING transition supplies it; `do`/`complete`/`run` leave it unset (the
	 * slice done-move is unchanged).
	 */
	lifecycle?: IntegrationLifecycle;
}

/**
 * The CORE's output — pure DATA. The core performed the gate/review/move/commit/
 * rebase/integrate AND the failure routing, but NOT the caller-specific tail.
 */
export interface IntegrationCoreResult {
	/** What the core resolved (the tail maps this 1:1 onto its own outcome). */
	outcome: IntegrationCoreOutcome;
	/**
	 * True iff a FAILURE outcome was routed to `work/needs-attention/` via the
	 * shared mechanism. False on the success path and when a failure was NOT moved
	 * (e.g. a red re-gate that stays put in recovery).
	 */
	routedToNeedsAttention: boolean;
	/** The work branch that was processed (`work/<slug>`). */
	branch: string;
	/**
	 * A human-readable summary of a FAILURE terminal condition, ready for the tail
	 * to surface VERBATIM. Absent on the success path (the tail composes the
	 * success message from the integration result + its own switch/delete state).
	 */
	reason?: string;
	/** The completion commit message that was authored, on success. */
	commitMessage?: string;
	/**
	 * The integration result — carries the EFFECTIVE mode (post-downgrade) + the
	 * PR url. Present on the success path; the tail reads `integration.mode` to
	 * decide its switch/ff behaviour, NEVER the requested mode.
	 */
	integration?: IntegrateResult;
	/**
	 * On a `review-blocked` outcome, the review gate's STRUCTURED block reason (the
	 * `formatBlockReason` of the blocking findings) — so a caller doing its OWN
	 * needs-attention routing can record the findings as the item-body prose. The
	 * slicing path (slice `slice-acceptance-gate`) reads this: its held PRD lives in
	 * `work/slicing/`, which the core's `applyNeedsAttentionTransition` (hard-coded
	 * to the build lifecycle's in-progress/done) cannot move, so it routes the PRD
	 * itself via the lock's `slicing/ -> needs-attention/` redirect, using THIS
	 * findings text as the body. Absent on every non-`review-blocked` outcome. (The
	 * build path ignores it — its routing already records the findings in-body.)
	 */
	reviewBlockReason?: string;
}

const DEFAULT_TYPE = 'feat';

/**
 * Run the shared gate→integrate band for a prepared (claimed, built, on-its-work-
 * branch) item. The HEAD has already resolved `cwd`/`arbiter`/`slug`/`source`/
 * `recovering`; this runs the gate, the review gate, the effective-mode decision,
 * the done-move + atomic commit + rebase + integrate, and routes ANY failure to
 * needs-attention — returning pure DATA for the caller's tail.
 *
 * It never throws for the expected gate-failed / review-blocked / rebase-conflict
 * cases (those are returned with the corresponding outcome). A genuinely
 * unexpected git plumbing failure (e.g. the done-move itself, or nothing staged)
 * throws — the caller's existing try/catch maps it.
 */
export async function performIntegration(
	input: IntegrationCoreInput,
): Promise<IntegrationCoreResult> {
	const cwd = input.cwd;
	const env = input.env;
	const arbiter = input.arbiter;
	const slug = input.slug;
	const source = input.source;
	const recovering = input.recovering;
	const note = input.note ?? (() => {});
	const branch = `work/${slug}`;
	// Captured from the Gate-2 review (when it runs + approves) so that AFTER the
	// propose integrate — where the opened PR url is finally in scope — we can post
	// the agent's deliberately-authored `review` prose as a PR comment (slice
	// `review-comment-prose-field`). Stays undefined when review is off / the agent
	// emitted no `review` field, so the post is skipped (no-op). The verdict/routing
	// decision uses neither.
	let approvedVerdict: ReviewVerdict | undefined;
	// `let` (not `const`): Gate 2's `autoMerge`-off policy may DOWNGRADE a resolved
	// `merge` to `propose` on an approve (review gates, a human merges) below.
	let mode = input.mode;

	// The file whose `title:` seeds the commit summary + PR title. For a SLICING
	// transition (a non-slice `lifecycle`) this is the held PRD it supplies; for a
	// build it is the slice in its source folder. Read BEFORE any move.
	const lifecycle = input.lifecycle;
	const sourcePath = lifecycle
		? lifecycle.titlePath
		: source === 'in-progress'
			? join(cwd, 'work', 'in-progress', `${slug}.md`)
			: join(cwd, 'work', 'needs-attention', `${slug}.md`);

	// 1. Gate: bad work never proceeds to done. Default-on; --skip-verify is a
	//    human-only escape hatch (the autonomous runner never skips — ADR §8).
	if (input.skipVerify) {
		note('Skipping the acceptance gate (--skip-verify).');
	} else {
		note('Running the acceptance gate (verify)…');
		const gate = await runVerify({cwd, verify: input.verify, env});
		if (!gate.passed && recovering) {
			// RECOVERY path, RED re-gate: the item is ALREADY in needs-attention/ (this
			// is a finish-the-stuck-item attempt, not a fresh in-progress completion).
			// The gate stays authoritative — a still-red item is NOT completed; it
			// simply STAYS in needs-attention/ (no re-route, no re-surface, no double
			// reason block). --skip-verify remains the only, human-only, loud override.
			const message =
				`Acceptance gate still failed (exit ${gate.exitCode}); '${slug}' stays in ` +
				'work/needs-attention/ (the cause is not actually fixed). Fix the work, ' +
				'or use --skip-verify to override.';
			note(message);
			return {
				outcome: 'gate-failed',
				routedToNeedsAttention: false,
				branch,
				reason: message,
			};
		}
		if (!gate.passed) {
			// Don't leave the item dangling in in-progress/: route it to
			// needs-attention/ with the reason (ADR §12) THROUGH the ledger write
			// seam's needs-attention transition. The item has NOT been committed/moved
			// yet, so the move bounces it straight from in-progress/ — recording the
			// reason + committing the move (with the agent's uncommitted work) as ONE
			// atomic transition. No partial state.
			const reason = `acceptance gate failed (exit ${gate.exitCode})`;
			const routed = await ledgerWrite.applyNeedsAttentionTransition({
				cwd,
				slug,
				reason,
				// Autonomous caller (`do`) passes the arbiter so the seam both SURFACES
				// the stuck state on `main` (OBSERVABLE, cross-machine visible) AND
				// pushes the `work/<slug>` branch (RECOVERABLE — a requeue-continue on
				// another machine, reading <arbiter>/work/<slug>, lands on the saved
				// wip). The human `complete` leaves it unset → no surface, no push,
				// local-only (a human is right there). One operation in one place: the
				// push lives in the seam (it is HEAD's branch — `work/<slug>` — here),
				// no bolted-on push to forget.
				arbiter: input.surfaceArbiter,
				env,
				note,
			});
			return {
				outcome: 'gate-failed',
				routedToNeedsAttention: routed.moved,
				branch,
				reason: routed.moved
					? `Acceptance gate failed (exit ${gate.exitCode}); routed '${slug}' ` +
						'to work/needs-attention/ (surfaced by status; return to backlog/ ' +
						'once resolved). Fix the work, or use --skip-verify to override.'
					: `Acceptance gate failed (exit ${gate.exitCode}); not completing ` +
						`'${slug}'. Fix the work, or use --skip-verify to override.`,
			};
		}
	}

	// 1b. Gate 2 — the PR/code REVIEW gate (GATES PRD `work/prd/review.md`),
	//     INSERTED BETWEEN the green `verify` and the done-move. It is a JUDGEMENT
	//     gate layered ON TOP of the deterministic `verify` floor (ADR §8) — NEVER a
	//     replacement: `verify` already ran (and is non-skippable), and only on its
	//     GREEN does control reach here. Runs ONLY when `review` resolves on.
	//
	//     The `review` SKILL runs as a FRESH-CONTEXT agent (its own harness launch,
	//     the injectable `reviewGate` seam), returning `{verdict, findings}`:
	//       approve → fall through to the done-move/commit/integrate unchanged;
	//       block   → route to needs-attention via the SAME machinery the red gate
	//                 uses (`applyNeedsAttentionTransition`, surfaced on
	//                 `surfaceArbiter` for the autonomous `do` path), with the
	//                 blocking findings recorded as the reason, no integrate.
	//     `reviewMaxRounds` bounds the revise↔review loop: the gate is invoked per
	//     round; a persistent `block` exhausts the rounds and ERRORS OUT to
	//     needs-attention (never silently merges or loops).
	if (input.review) {
		const reviewGate = input.reviewGate;
		if (!reviewGate) {
			// `review` on with no gate wired is a usage error — the floor must never
			// be silently skipped. (Production always wires `harnessReviewGate`.) The
			// caller's try/catch maps a thrown error to its usage-error outcome.
			throw new Error(
				`review is on but no review gate is configured — cannot run Gate 2 ` +
					`for '${slug}' (this is a wiring bug; the gate must not be skipped).`,
			);
		}
		const maxRounds = Math.max(1, input.reviewMaxRounds ?? 2);
		note('Running the PR/code review gate (Gate 2)…');
		let approved = false;
		let lastVerdict: ReviewVerdict | undefined;
		for (let round = 1; round <= maxRounds; round++) {
			const verdict = await reviewGate({
				slug,
				cwd,
				reviewModel: input.reviewModel,
				round,
				// `--watch` threading (slice `watch-review-session`): when on, the
				// production gate tails the review session live (after the build stream,
				// with a build→review boundary). OFF ⇒ the gate does its plain sync
				// launch, unchanged. The stub gate (tests / non-harness) ignores these.
				watch: input.watch,
				watchSink: input.watchSink,
				color: input.color,
				sessionsDir: input.sessionsDir,
				// The review AGENT launches with the AMBIENT env, never the identity-
				// scoped `env` (an agent must not act as the bot). Falls back to `env`
				// when no identity is configured (unchanged for non-identity callers).
				env: input.agentEnv ?? env,
			});
			lastVerdict = verdict;
			if (verdict.verdict === 'approve') {
				approved = true;
				break;
			}
			// A `block`: re-review up to `reviewMaxRounds` (a future builder-revise
			// step plugs in here). A persistent block exhausts the loop → routed below.
		}
		if (!approved) {
			// NON-approve verdict: route to needs-attention via the SAME seam the red
			// gate uses, NEVER integrate. The reason records the blocking findings AND
			// (since the loop ran every allowed round without an approve) notes the
			// `reviewMaxRounds` bound was hit — a single block IS exhaustion when
			// maxRounds=1, satisfying both "block → findings" and "exhaustion → forced
			// needs-attention" criteria with one route.
			// The blocking findings (the slice-path caller records exactly this as the
			// item body; the build path appends the rounds-exhaustion note below).
			const findingsReason = lastVerdict ? formatBlockReason(lastVerdict) : '';
			const reason =
				(findingsReason ? findingsReason + '\n' : '') +
				reviewRoundsExhaustedReason(maxRounds);
			const routed = await ledgerWrite.applyNeedsAttentionTransition({
				cwd,
				slug,
				reason,
				// Same autonomous-vs-human gate as the red-gate path: `do` passes the
				// arbiter (surface on main + push the branch), the human `complete`
				// leaves it unset (local-only).
				arbiter: input.surfaceArbiter,
				env,
				note,
			});
			const message = routed.moved
				? `PR/code review (Gate 2) blocked '${slug}'; routed it to ` +
					'work/needs-attention/ (surfaced by status; the blocking findings are ' +
					'recorded in the item body). NOT integrated.'
				: `PR/code review (Gate 2) blocked '${slug}'; NOT integrating.`;
			note(message);
			return {
				outcome: 'review-blocked',
				routedToNeedsAttention: routed.moved,
				branch,
				reason: message,
				// The structured block reason (the blocking findings ONLY — no
				// rounds-exhaustion note, which is a build-gate concept) for a caller doing
				// its OWN routing (the slicing path); the build path ignores it.
				reviewBlockReason: findingsReason || message,
			};
		}
		note(`PR/code review (Gate 2) approved '${slug}'.`);
		// Carry the approved verdict (with its authored `review` prose) past the review
		// block so that AFTER the propose integrate — once the opened PR url is in
		// scope — we can post it as a PR comment (see the post-integrate block below).
		approvedVerdict = lastVerdict;
		// APPROVE-with-non-blocking-findings: give the reviewer's NITS a durable,
		// contract-native home (GATES PRD `work/prd/review.md`;
		// `work/findings/review-nonblocking-findings-disposition.md`). On a BLOCK the
		// blocking findings already land in needs-attention/; on an APPROVE the parsed
		// non-blocking findings would otherwise EVAPORATE (terminal/session log only).
		// So — post-decision, the verdict/routing UNCHANGED — the RUNNER (not the
		// write-free review agent) writes ONE per-run observation of this run's
		// non-blocking findings. It is written to disk HERE, BEFORE the done-move
		// (step 2) + the atomic `git add -A` commit (step 3), so it is swept into that
		// SAME done-commit on EVERY path (merge / propose / CI, `do` AND `run`) — NO
		// separate commit/move/surface (that is the BLOCK path's heavier
		// `applyNeedsAttentionTransition`, the WRONG model here). Zero non-blocking
		// findings ⇒ nothing is written (no empty-file spam).
		writeReviewNitsObservation({
			cwd,
			slug,
			findings: lastVerdict?.findings ?? [],
			note,
		});
		// approve + `autoMerge` OFF → DOWNGRADE a resolved `merge` to `propose`: review
		// gated (approve), but the autonomous merge is opt-in repo policy, so a human
		// does the merge (`--propose` semantics). With `autoMerge` ON, the resolved
		// `merge` proceeds autonomously below. A non-approve never reaches here.
		if (mode === 'merge' && !input.autoMerge) {
			note(
				`autoMerge is off — leaving the merge to a human (proposing '${slug}' ` +
					'instead of auto-merging an approved review).',
			);
			mode = 'propose';
		}
	}

	// Read the title now, BEFORE the move, for the default commit summary AND the
	// synthesised propose-mode PR TITLE (the source file is about to be git-mv'd
	// away). The PR title is a SINGLE, capped line built runner-side from the
	// slice's `title:` frontmatter + the slug (`<type>(<slug>): <title>`) so it can
	// never be the multi-line commit-subject run-on `--fill` would derive.
	const defaultMessage = defaultSummary(sourcePath, slug);
	const sliceTitle = readSliceTitle(sourcePath);
	const prTitle = synthesiseProposeTitle({
		type: (input.type ?? DEFAULT_TYPE).trim() || DEFAULT_TYPE,
		slug,
		title: sliceTitle,
	});

	// 2. STAGE the item move into the index. For a build that is the slice done-move
	//    (`git mv work/<source>/<slug>.md → work/done/<slug>.md`); for a SLICING
	//    transition (a non-slice `lifecycle`) it is the caller-supplied PRD
	//    lifecycle move + emitted backlog files (the runner stages them, the agent
	//    never does git). Either way the subsequent `git add -A` folds the agent's
	//    uncommitted work + this staging into ONE atomic commit.
	if (lifecycle) {
		await lifecycle.stage();
	} else {
		mkdirSync(join(cwd, 'work', 'done'), {recursive: true});
		await gitHard(
			['mv', `work/${source}/${slug}.md`, `work/done/${slug}.md`],
			cwd,
			env,
		);
	}

	// 3. Commit: git add -A (the agent's uncommitted work + the move) into ONE
	//    atomic commit. Nothing to commit is FATAL (no-op-is-fatal, like claim.sh).
	await gitHard(['add', '-A'], cwd, env);
	if (await nothingStaged(cwd, env)) {
		throw new IntegrationNothingStaged(
			`nothing to commit for '${slug}' — no work and no move staged. ` +
				'(Did the agent produce changes? Is the slice already done?)',
		);
	}
	const summary = input.message ?? defaultMessage;
	const type = (input.type ?? DEFAULT_TYPE).trim() || DEFAULT_TYPE;
	// The trailing transition tag: a build is `; done`, a SLICING transition is
	// `; sliced` (the lifecycle supplies it). Keeps the runner-owned commit subject
	// honest about WHICH lifecycle landed.
	const commitMessage = `${type}(${slug}): ${summary}; ${lifecycle?.commitTag ?? 'done'}`;
	await gitHard(['commit', '-q', '-m', commitMessage], cwd, env);
	note(`Committed: ${commitMessage}`);

	// 4. Rebase-before-integrate (ADR §10): rebase the work branch onto the
	//    latest <arbiter>/main. Clean → continue. Conflict → abort + stop.
	//
	//    RECOVERY reconciliation: when completing FROM needs-attention/, the work
	//    branch's history still carries the original `in-progress → needs-attention`
	//    MOVE-ONLY commit, and `<arbiter>/main` was SURFACED with that same move
	//    (the item is in needs-attention/ on main). Replaying that historical move
	//    onto main conflicts (main has no in-progress/<slug>.md) — exactly the
	//    rebase conflict the human hit doing this by hand. So we DROP that move-only
	//    commit during the rebase: the replay becomes `wip + (needs-attention →
	//    done)`, which applies cleanly onto the surfaced main (it HAS the item in
	//    needs-attention/). The done-move thus SUPERSEDES the surfaced state — no
	//    leftover/conflicting on-`main` surface for the human to resolve.
	// Fetch the arbiter's `main` into the `<arbiter>/main` remote-tracking ref
	// EXPLICITLY. A `run` JOB WORKTREE is cut from a bare hub mirror whose remote
	// has no fetch refspec (so `<arbiter>/main` would not otherwise resolve / would
	// be stale, causing a spurious rebase conflict); a regular clone (`do`/
	// `complete`) already has it, where the explicit refspec is harmless (the same
	// refspec `rebaseOntoArbiterMain` used before the convergence).
	await gitHard(
		[
			'fetch',
			'--quiet',
			arbiter,
			`+refs/heads/main:refs/remotes/${arbiter}/main`,
		],
		cwd,
		env,
	);
	// A SLICING transition (a non-slice `lifecycle`) never recovers a surfaced
	// needs-attention move, so it always uses the plain rebase.
	const rebase =
		recovering && !lifecycle
			? await rebaseDroppingNeedsAttentionSurface(cwd, arbiter, slug, env)
			: await gitSoft(['rebase', `${arbiter}/main`], cwd, env);
	if (rebase.status !== 0) {
		// NEVER auto-resolve: abort the rebase (back to a clean work-branch tip).
		await gitSoft(['rebase', '--abort'], cwd, env);
		// Then route the item to needs-attention/ with the conflict reason (ADR
		// §12) THROUGH the ledger write seam's needs-attention transition, rather
		// than leaving it dangling in done/. The done-move was already committed
		// above, so the item sits in work/done/; the move bounces it from there and
		// commits the in-progress→needs-attention move (here done→needs-attention)
		// as ONE transition. No partial state.
		const reason = `rebase onto ${arbiter}/main conflicted (aborted, never auto-resolved)`;
		const routed = await ledgerWrite.applyNeedsAttentionTransition({
			cwd,
			slug,
			reason,
			// Autonomous caller (`do`) passes the arbiter so the seam both surfaces the
			// conflict on `main` (OBSERVABLE) AND pushes the `work/<slug>` branch
			// (RECOVERABLE, cross-machine). The human `complete` leaves it unset →
			// no surface, no push, local-only. The push lives in the seam (HEAD's
			// branch is `work/<slug>` here) — no bolted-on push.
			arbiter: input.surfaceArbiter,
			env,
			note,
		});
		return {
			outcome: 'rebase-conflict',
			routedToNeedsAttention: routed.moved,
			branch,
			commitMessage,
			reason: routed.moved
				? `Rebasing ${branch} onto ${arbiter}/main conflicted; the rebase was ` +
					`aborted (never auto-resolved) and '${slug}' was routed to ` +
					'work/needs-attention/ (surfaced by status). Resolve against the ' +
					'latest main, then return it to backlog/ and re-run.'
				: `Rebasing ${branch} onto ${arbiter}/main conflicted; the rebase was ` +
					'aborted (never auto-resolved). Resolve against the latest main, ' +
					'then re-run complete.',
		};
	}

	// 5. Integrate per mode through the ledger write seam's COMPLETE transition
	//    (ADR §6 + `docs/adr/claim-ledger-vs-protected-main.md`). The rebase above
	//    already brought the branch up to date, so the seam's sole strategy uses
	//    `integrate` (not `integrateWithRebase`) and never --forces. Provider
	//    selection: an injected `openPr` wins (legacy bridge); otherwise pick by
	//    the `provider` override LAYERED OVER auto-detection from the arbiter's
	//    remote URL (a GitHub remote ⇒ `gh pr create`, else push-only `none`). A
	//    missing/unauthenticated `gh` degrades to push-only at runtime — never a
	//    hard failure. The seam is storage-agnostic: we hand it the work branch,
	//    the integration mode, and the provider — `main` lives only in the strategy.
	// Provider precedence: an injected fully-formed provider wins (the `run`
	// stubbed-provider seam, carrying title/body/url); else the legacy `openPr`
	// bridge; else select by the `provider` override LAYERED OVER auto-detection
	// from the arbiter URL.
	const provider =
		input.providerInstance ??
		(input.openPr
			? bridgeProvider(input.openPr)
			: selectProvider({
					arbiterUrl: await arbiterUrl(cwd, arbiter, env),
					provider: input.provider,
				}));
	const integration = await ledgerWrite.applyCompleteTransition({
		arbiter,
		branch,
		mode,
		provider,
		// Half A: an explicit single-line PR title (propose mode), so `gh` no longer
		// derives a run-on title from the commit subject via `--fill`.
		title: prTitle,
		// Half B: the propose-mode PR body — the agent's summary under a deterministic
		// runner header (slice pointer). Undefined when no body was supplied (the
		// header is only scaffolded when there IS a body) ⇒ today's `--fill` (no
		// regression). Ignored in merge mode by the provider/integrator.
		body: composeProposeBody({slug, body: input.body}),
		cwd,
		env,
	});

	// 6. Make the Gate-2 review VISIBLE on the PR (slice `review-comment-prose-field`,
	//    refining `review-gate-pr-comment`): AFTER the propose integrate, where the
	//    approved verdict (with its deliberately-authored `review` prose), the
	//    resolved `provider`, AND the opened PR url (`integration.url`) are ALL in
	//    scope, post `verdict.review` as a comment on that PR — INCLUDING on approve
	//    (the audit trail; decided 2026-06-06). The `review` field is a first-class
	//    AUTHORED review (the prompt requires it), NOT the residue around the JSON
	//    — posting the residue was the bug
	//    (`work/findings/review-comment-posts-agent-thinking-not-a-review.md`). It
	//    reuses the SAME `provider` the integrate used (the core never imports `gh`).
	//    The comment is ADVISORY: it changes no gate/verdict/merge/integration logic
	//    — by here the verdict has ALREADY routed (block never reaches this point; it
	//    routed to needs-attention above) and the integrate has ALREADY happened.
	//    No PR url (merge mode, or a degraded/push-only propose) ⇒ a clean no-op:
	//    the review stays in the run output; `postPRComment` is never called and never
	//    throws. Because this lives in the shared core, BOTH `do`/`complete` AND
	//    `run` post the comment — no per-caller wiring.
	if (approvedVerdict?.review !== undefined && integration.url !== undefined) {
		const posted = provider.postPRComment({
			cwd,
			url: integration.url,
			body: approvedVerdict.review,
			env,
		});
		note(posted.instruction);
	}

	return {
		outcome: 'completed',
		routedToNeedsAttention: false,
		branch,
		commitMessage,
		integration,
	};
}

/**
 * Raised when the atomic completion commit has NOTHING staged (no agent work and
 * no move) — a deliberate REFUSAL, mapped by `complete`'s try/catch to its
 * `refused` outcome (preserving its existing message verbatim). Exported so the
 * caller can `instanceof`-route it.
 */
export class IntegrationNothingStaged extends Error {}

/**
 * The arbiter's remote URL for `arbiter` in `cwd` (for provider auto-detection),
 * or `undefined` when it cannot be resolved. Read-only; soft (never throws).
 */
async function arbiterUrl(
	cwd: string,
	arbiter: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string | undefined> {
	const res = await gitSoft(['remote', 'get-url', arbiter], cwd, env);
	if (res.status !== 0) {
		return undefined;
	}
	const url = res.stdout.trim();
	return url === '' ? undefined : url;
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
		async openRequest(req) {
			openPr({cwd: req.cwd, branch: req.branch, env: req.env});
			return {
				opened: true,
				instruction: `Opened a review for ${req.branch}.`,
			};
		},
		// The legacy `openPr` bridge has no comment channel (it returns no PR url),
		// so postPRComment degrades: it never opens a PR url to comment on, so the
		// in-core poster no-ops anyway. Implemented for the seam, surfacing the text.
		postPRComment(req) {
			return {
				posted: false,
				instruction:
					'The legacy review bridge cannot post a comment; the review:\n' +
					req.body,
			};
		},
	};
}

/**
 * Default commit summary: the slice's `title` frontmatter with any leading
 * `slug — ` (or `slug -`) prefix stripped, so a slice titled
 * "complete — gate, mark done, …" yields "gate, mark done, …". Falls back to a
 * generic summary when the title is missing/unreadable.
 */
function defaultSummary(inProgressPath: string, slug: string): string {
	let title: string | undefined;
	try {
		title = readTitle(readFileSync(inProgressPath, 'utf8'));
	} catch {
		title = undefined;
	}
	if (!title) {
		return 'complete work slice';
	}
	// Strip a leading "slug" followed by an em-dash / en-dash / hyphen separator.
	const prefix = new RegExp(`^${escapeRegExp(slug)}\\s*[—–-]\\s*`, 'i');
	return title.replace(prefix, '').trim() || title;
}

/**
 * The sane single-line cap for a synthesised PR title (Half A). GitHub itself
 * accepts long titles, but a PR list/notification truncates ugly past ~72 chars;
 * we cap to keep the title scannable and guarantee it is never a run-on. Beyond
 * the cap we truncate and append an ellipsis (counted within the cap).
 */
export const PR_TITLE_MAX = 72;

/**
 * The slice's raw `title:` frontmatter (NOT the commit-summary-stripped form),
 * or undefined when missing/unreadable. Used as the human-authored source for
 * the synthesised PR title.
 */
function readSliceTitle(slicePath: string): string | undefined {
	try {
		return readTitle(readFileSync(slicePath, 'utf8'));
	} catch {
		return undefined;
	}
}

/**
 * Synthesise the propose-mode PR TITLE runner-side (Half A) from data the runner
 * already has — NO agent text: `<type>(<slug>): <title>`, reusing the `--type`
 * convention (default `feat`). It is FORCED to a single line (newlines → spaces,
 * runs of whitespace collapsed) and CAPPED to {@link PR_TITLE_MAX} (truncating
 * with a trailing `…`), so it can NEVER be the multi-line run-on `gh ... --fill`
 * derives from the commit subject. When the slice `title:` is missing it falls
 * back to the slug alone (`<type>(<slug>)`). Exported for unit tests of the
 * single-line + cap guarantee.
 */
export function synthesiseProposeTitle(input: {
	type: string;
	slug: string;
	title?: string;
}): string {
	const type = input.type.trim() || DEFAULT_TYPE;
	// Strip a leading `slug — ` / `slug -` prefix (some slice titles repeat the
	// slug; the `<slug>` scope already carries it) and flatten to one line.
	const prefix = new RegExp(`^${escapeRegExp(input.slug)}\\s*[—–-]\\s*`, 'i');
	const cleanTitle = (input.title ?? '')
		.replace(prefix, '')
		.replace(/\s+/g, ' ')
		.trim();
	const composed =
		cleanTitle === ''
			? `${type}(${input.slug})`
			: `${type}(${input.slug}): ${cleanTitle}`;
	if (composed.length <= PR_TITLE_MAX) {
		return composed;
	}
	// Cap, reserving one char for the ellipsis (counted within the cap).
	return composed.slice(0, PR_TITLE_MAX - 1).trimEnd() + '…';
}

/**
 * Compose the propose-mode PR BODY (Half B): the supplied advisory prose (the
 * build agent's final summary, or a human `--body`) UNDER a deterministic runner
 * header that points a reviewer back to the slice file. Returns `undefined` when
 * no body was supplied — so the provider degrades to today's `gh ... --fill` (no
 * regression); the header is ONLY scaffolded when there IS prose to carry.
 * Exported for unit tests of the header + pointer.
 */
export function composeProposeBody(input: {
	slug: string;
	body?: string;
}): string | undefined {
	const prose = input.body?.trim();
	if (!prose) {
		return undefined;
	}
	const header = `Slice: \`work/done/${input.slug}.md\``;
	return `${header}\n\n${prose}`;
}

/**
 * On a review APPROVE that carries ≥1 NON-BLOCKING finding, write ONE per-run
 * observation `work/observations/review-nits-<slug>-<YYYY-MM-DD>.md` capturing all
 * of this run's non-blocking nits, so they get a durable, contract-native home
 * instead of evaporating (the block path already routes BLOCKING findings to
 * needs-attention/; the approve path dropped non-blocking ones — see
 * `work/findings/review-nonblocking-findings-disposition.md`).
 *
 * The RUNNER writes it (the review agent stays write-free). It is a PLAIN
 * pre-commit disk write — NOT the heavier `applyNeedsAttentionTransition`
 * move/commit/surface — so `performIntegration`'s subsequent done-move + atomic
 * `git add -A` commit sweeps it into the SAME done-commit on every path
 * (merge / propose / CI, `do` AND `run`); it is never left dangling/uncommitted.
 *
 * ZERO non-blocking findings ⇒ writes NOTHING (no empty-file spam). The file is
 * ONE-per-RUN (a content-derived, dated name), never an append to a shared ledger
 * — the dated `<slug>-<date>` name makes a later-abandoned run's nit-observation
 * trivially findable + deletable (lifecycle hygiene). Frontmatter mirrors the
 * `work/observations/*.md` convention (`title` / `date` / `status: open`) plus a
 * pointer to the slug it came from, so it gets triaged like any observation.
 */
function writeReviewNitsObservation(params: {
	cwd: string;
	slug: string;
	findings: ReviewFinding[];
	note: (message: string) => void;
}): void {
	const nits = params.findings.filter((f) => f.severity === 'non-blocking');
	// No empty observations: an approve with zero non-blocking findings writes none.
	if (nits.length === 0) {
		return;
	}
	const date = observationDate();
	const obsDir = join(params.cwd, 'work', 'observations');
	mkdirSync(obsDir, {recursive: true});
	const filename = `review-nits-${params.slug}-${date}.md`;
	writeFileSync(
		join(obsDir, filename),
		renderReviewNitsObservation({slug: params.slug, date, nits}),
	);
	params.note(
		`Recorded ${nits.length} non-blocking review nit(s) for '${params.slug}' ` +
			`in work/observations/${filename}.`,
	);
}

/** Today's date as `YYYY-MM-DD` (UTC), for the dated observation filename. */
function observationDate(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * Render the per-run review-nits observation file body — `observations/`-convention
 * frontmatter (`title` / `date` / `status: open`) plus a `slug:` pointer to the run
 * it came from, then each non-blocking finding (its `question` + optional
 * `context`), and a one-line note that these are review-gate nits for triage
 * (promote-to-slice / keep / delete). Exported-free pure string builder.
 */
function renderReviewNitsObservation(input: {
	slug: string;
	date: string;
	nits: ReviewFinding[];
}): string {
	const findingBlocks = input.nits.map((f) => {
		const ctx = f.context ? `\n  (${f.context})` : '';
		return `- ${f.question}${ctx}`;
	});
	return [
		'---',
		`title: review-gate non-blocking nits for '${input.slug}' (Gate 2 approve)`,
		`date: ${input.date}`,
		'status: open',
		`slug: ${input.slug}`,
		'---',
		'',
		'## Non-blocking review findings',
		'',
		`The PR/code review gate (Gate 2) APPROVED '${input.slug}' but raised the`,
		'following non-blocking findings (nits). They do not block integration; this',
		'is their durable home for triage — promote-to-slice / keep / delete.',
		'',
		...findingBlocks,
		'',
	].join('\n');
}

/** Read the `title:` scalar from a slice's frontmatter block, or undefined. */
function readTitle(content: string): string | undefined {
	const normalized = content.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
	if (!normalized.startsWith('---\n')) {
		return undefined;
	}
	const lines = normalized.split('\n');
	const closing = lines.indexOf('---', 1);
	const block = closing === -1 ? lines.slice(1) : lines.slice(1, closing);
	for (const line of block) {
		const match = /^title\s*:\s*(.*)$/.exec(line);
		if (match) {
			const value = match[1].trim();
			return value === '' ? undefined : unquote(value);
		}
	}
	return undefined;
}

function unquote(value: string): string {
	if (value.length >= 2) {
		const first = value[0];
		const last = value[value.length - 1];
		if ((first === '"' || first === "'") && last === first) {
			return value.slice(1, -1);
		}
	}
	return value;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when the index has no staged changes against HEAD (nothing to commit). */
async function nothingStaged(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
	// `diff --cached --quiet` exits 0 when there is NOTHING staged, 1 when there is.
	const res = await gitSoft(['diff', '--cached', '--quiet'], cwd, env);
	return res.status === 0;
}

/**
 * The RECOVERY rebase: rebase the work branch onto `<arbiter>/main` while
 * DROPPING the historical `in-progress → needs-attention` move-only commit, so
 * the replay does not conflict with the surfaced needs-attention state already
 * on `main`.
 *
 * The work branch (as the autonomous `do`/`run` path left it) carries, ABOVE the
 * claim-time main: a `wip` commit (the aborted agent work), the route-to-
 * needs-attention `chore(<slug>): route to needs-attention; …` MOVE-ONLY commit,
 * and (just committed by `complete`) the `needs-attention → done` done-move. The
 * arbiter's `main` was surfaced to ALSO hold the item in needs-attention/, so a
 * plain rebase replays the historical move-only commit (in-progress → needs-
 * attention) onto a main that has no in-progress/<slug>.md → conflict.
 *
 * We rebase the whole range `(merge-base, HEAD]` `--onto <arbiter>/main` and use
 * a `GIT_SEQUENCE_EDITOR` that DELETES the move-only commit's line from the todo
 * list (matched by its message). The remaining `wip + (needs-attention → done)`
 * replays cleanly: wip touches only the agent's files, and the done-move's
 * `git mv work/needs-attention/<slug>.md → work/done/<slug>.md` applies because
 * the surfaced main HAS the item in needs-attention/. Result: the done-move
 * supersedes the surfaced state, and the human never sees a conflict.
 *
 * When the branch carries NO such move-only commit (e.g. a needs-attention item
 * placed by hand, never autonomously surfaced), the editor deletes nothing and
 * this degrades to a normal rebase. The seam returns the rebase RunResult so the
 * caller's existing conflict-abort path handles a genuine (non-surface) conflict
 * unchanged.
 */
async function rebaseDroppingNeedsAttentionSurface(
	cwd: string,
	arbiter: string,
	slug: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<RunResult> {
	// The branch we are ON (the work branch). Rebasing must UPDATE this ref — so
	// we pass the branch NAME to `git rebase` (passing the literal `HEAD` would
	// rebase in DETACHED mode and leave the branch ref behind).
	const onBranch = (
		await gitSoft(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd, env)
	).stdout.trim();
	const base = (
		await gitSoft(['merge-base', 'HEAD', `${arbiter}/main`], cwd, env)
	).stdout.trim();
	if (base === '') {
		// No common ancestor (shouldn't happen for a branch cut from main): fall
		// back to a plain rebase so the caller's conflict path still governs.
		return gitSoft(['rebase', `${arbiter}/main`], cwd, env);
	}
	// A sequence editor that strips the route-to-needs-attention move-only commit
	// from the interactive todo list. `routeToNeedsAttention` authors it as
	// `chore(<slug>): route to needs-attention; <reason>` — match that prefix and
	// delete those `pick` lines, leaving the wip + the done-move to replay.
	const rebaseEnv: NodeJS.ProcessEnv = {
		...(env ?? process.env),
		GIT_SEQUENCE_EDITOR: dropMoveOnlySequenceEditor(slug),
		// Keep the rebase non-interactive for the commit-message editor too.
		GIT_EDITOR: 'true',
	};
	return gitSoft(
		onBranch === ''
			? ['rebase', '-i', '--onto', `${arbiter}/main`, base]
			: ['rebase', '-i', '--onto', `${arbiter}/main`, base, onBranch],
		cwd,
		rebaseEnv,
	);
}

/**
 * Build a one-shot `GIT_SEQUENCE_EDITOR` command (a `sed` invocation) that
 * deletes, from the rebase todo file (passed as `$1`), every `pick` line whose
 * subject is the route-to-needs-attention move-only commit for `slug`
 * (`chore(<slug>): route to needs-attention`). Deleting a `pick` line drops that
 * commit from the rebase — the mechanism for skipping the move that conflicts
 * with the surfaced main. Anchored to the slug so no unrelated commit is dropped.
 */
function dropMoveOnlySequenceEditor(slug: string): string {
	// The todo line looks like: `pick <sha> chore(<slug>): route to needs-attention; …`
	// Escape any sed-special characters in the slug before embedding it.
	const escaped = slug.replace(/[\\/&.[\]*^$]/g, '\\$&');
	return `sed -i -e '/^pick [0-9a-f]* chore(${escaped}): route to needs-attention/d'`;
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
