import {existsSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {
	parseSidecar,
	resolveSidecarIdentity,
	sidecarPathFor,
	type SidecarModel,
} from './sidecar.js';
import {run as runProc} from './git.js';
import {createJob, withCheckoutCommitIdentity, type Job} from './workspace.js';
import {continueRebaseSentence} from './continue-branch.js';
import {ensureMirrorMain, type EnsureMirrorResult} from './repo-mirror.js';
import {
	performIntegration,
	type IntegrationCoreInput,
	type IntegrationCoreResult,
} from './integration-core.js';
import {
	changedFileBlobs,
	lfsObjectPath,
	localLfsObjectsDir,
	scanLfsPointers,
} from './ci-handoff-lfs.js';
import {commitAbortedWork} from './needs-attention.js';
import {createPhaseRecorder, runAgentPhase} from './phase-recorder.js';
import type {VerifyConfig} from './verify.js';

/**
 * The **answered MERGE-QUESTION ACTION DISPATCH** (spec
 * `land-time-reverify-and-parallel-merge-ceiling`, task
 * `apply-rung-merge-disposition`; Stories #15, #16) — the deterministic,
 * answer-driven RUNNER-ACTION layer that turns an answered
 * `kind: merge` sidecar entry into a LAND through the EXISTING
 * `integration-core.ts` land primitive (rebase → re-verify on the rebased tip →
 * advance).
 *
 * This is a SIBLING of the agentic `decide()` content-decision in
 * `apply-decide.ts`, NOT a route through it: a merge-acceptance has no
 * judgement content (the human's plain `merge | hold | drop` answer IS the
 * decision; the apply-time fresh-worktree re-verify on the rebased tip is the
 * real correctness gate). Per the SPEC's resolved mechanism, routing this
 * through an LLM only adds cost and non-determinism, so the apply rung
 * KIND-CHECKS the sidecar BEFORE calling the agentic decider: a sidecar entry
 * carrying `kind: merge` (the typed dispatch field from `sidecar-kind-field`,
 * stamped by `merge-question-surfacer`) dispatches HERE deterministically;
 * content kinds (observation / triage / spec) keep going through `decide()` as
 * today.
 *
 * The KEYING is the question identity + the human's plain answer:
 *
 *   - `answer ≈ merge` → invoke the LAND primitive (see {@link performMergeLand})
 *     with `committedRecovery: true` + `freshWorktreeGate: true`. The unmerged
 *     `work/<slug>` is checked out via the EXISTING `workspace.ts` per-job
 *     worktree seam ({@link createJob} off the hub mirror), NOT a bespoke
 *     worktree/clone; `performIntegration` then re-verifies the REBASED tip and
 *     REFUSES on red (routes to needs-attention through its own shared seam),
 *     so `main` never receives a tree that fails `verify`.
 *   - `answer ≈ hold` → SKIP the land; the apply rung still records the answer
 *     in the item body via the normal apply path (the work branch stays
 *     unmerged; the next surface pass may re-emit a question).
 *   - `answer ≈ drop` → SKIP the land; the apply rung still records the answer
 *     in the item body via the normal apply path. (Cancellation of the work
 *     branch itself is out of this task's scope — the question is recorded as
 *     "drop" and the human / a later surfacer handles the artifact.)
 *
 * The STALE-APPROVAL POLICY (SPEC OQ6, applied answer q1): default is the cheap
 * "HONOUR the prior approval + land on a green re-verify" path; opt-in
 * `strictMergeApproval` (resolved per-repo via the gate-family precedence chain
 * by the sibling task `strict-merge-approval-gate`, default OFF) RE-SURFACES
 * the merge-question instead of landing when `main`'s code moved since the
 * question was asked (its recorded `askedAtMain`; see `approvedBaseMoved`).
 * The RED-re-verify refusal is unchanged in both modes.
 *
 * House-style boundary: this module is the DETERMINISTIC DISPATCH LAYER. It
 * does NOT re-implement rebase / verify / integrate (it drives the EXISTING
 * `performIntegration` with `committedRecovery: true` + `freshWorktreeGate:
 * true`, which {@link createJob} cuts the worktree for), and it does NOT
 * improvise a worktree or clone (it uses the same `createJob` seam the build /
 * recovery callers use). Tests inject the {@link MergeActionHandler} seam so
 * they assert on EXTERNAL behaviour (what lands on `main`, what routes to
 * needs-attention, that `verify` ran on the rebased tip).
 */

export {
	answeredMergeActionIn,
	parseMergeAnswer,
	type DetectedMergeAction,
	type MergeActionVerb,
} from './merge-answer.js';
import {
	answeredMergeActionIn,
	type DetectedMergeAction,
} from './merge-answer.js';

/**
 * Detect the `kind: merge` action verb that should drive the next apply run.
 * The apply rung's pre-decider kind-check; returns `undefined` when there is
 * nothing for the dispatcher to act on.
 *
 * ORDERING (task `merge-action-nits-followup` nit 1). The re-stale re-surface
 * path (`advance.ts` `maybeRunMergeAction` restale branch) APPENDS a new
 * `kind: merge` follow-up via `appendQuestions` rather than clearing the prior
 * `answer=merge` on the original entry — that append-and-keep-history shape is
 * canonical, but a naive FIRST-match lookup would re-fire against the STALE
 * prior answer instead of the human's fresh follow-up. So:
 *
 *   1. If ANY `kind: merge` entry is UNANSWERED, return `undefined` — that is
 *      the re-paused state (a freshly-appended follow-up awaiting an answer),
 *      and the apply MUST NOT fire against a stale prior sibling.
 *   2. Otherwise return the LATEST answered `kind: merge` entry — a fresh
 *      follow-up answer wins over the stale one, and a plain single-entry
 *      merge-question sidecar behaves as before.
 *
 * The sidecar is read OFF DISK keyed off the namespaced item identity; the
 * model is parsed via the SAME `parseSidecar` the rest of the engine uses.
 * Returns `undefined` on a missing/unparseable sidecar (the caller's normal
 * apply path will then raise the right error).
 */
export function detectAnsweredMergeAction(
	cwd: string,
	item: string,
): DetectedMergeAction | undefined {
	const abs = join(cwd, sidecarPathFor(item));
	if (!existsSync(abs)) return undefined;
	let model: SidecarModel;
	try {
		model = parseSidecar(readFileSync(abs, 'utf8'));
	} catch {
		return undefined;
	}
	return answeredMergeActionIn(model);
}

/** Input the production merge-action handler consumes. */
export interface MergeActionInput {
	/** The detected action (verb + source entry). */
	action: DetectedMergeAction;
	/** The namespaced item identity (`task:<slug>`). */
	item: string;
	/** The bare slug (the work branch is `work/task-<slug>` / `work/<slug>`). */
	slug: string;
	/** The apply rung's working clone (used to resolve the arbiter URL when needed). */
	cwd: string;
	/** The arbiter remote NAME in `cwd` (defaults to `origin`). */
	arbiter: string;
	/**
	 * The arbiter URL the land worktree mirrors from. When set, used DIRECTLY
	 * (the registry-set advance driver threads the per-mirror origin URL here).
	 * When unset, the URL is resolved from `cwd` + `arbiter` via `git remote
	 * get-url` (the in-place / one-shot caller).
	 */
	arbiterUrl?: string;
	/** The execution working area (`~/.dorfl` by default) `createJob` cuts under. */
	workspacesDir: string;
	/** Per-repo env-prep config the fresh-worktree gate runs before `verify`. */
	prepare?: VerifyConfig;
	/** Per-repo acceptance gate (`verify`). */
	verify?: VerifyConfig;
	/**
	 * `strictMergeApproval` (resolved per-repo by the sibling task
	 * `strict-merge-approval-gate`; default OFF). OFF ⇒ honour the prior answer
	 * + land on a green re-verify (the cheap default). ON ⇒ re-surface the
	 * merge-question when `main`'s code moved since the question was asked
	 * (don't land; the apply rung folds this into a re-pause).
	 */
	strictMergeApproval?: boolean;
	/** Bounded recovery-rebase retry knob (mirrors the build path). */
	recoveryRebaseRetries?: number;
	/** Modest livelock-spreading jitter (ms) between recovery-rebase retries. */
	recoveryRebaseJitterMs?: number;
	/** Cross-job land-CAS retry cap (the `mergeRetries` precedence chain). */
	mergeRetries?: number;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

/** The terminal verbs the dispatcher reports to the apply rung. */
export type MergeActionOutcome =
	/** `answer=merge` + green re-verify ⇒ the kept commit landed on `<arbiter>/main`. */
	| 'landed'
	/** `answer=merge` + the kept tip was already on `<arbiter>/main` (idempotent re-run). */
	| 'already-integrated'
	/**
	 * `answer=merge` + RED re-verify on the rebased tip (or a rebase-conflict): the
	 * land was REFUSED; `performIntegration` routed the item to needs-attention
	 * through its shared seam — `main` never received the failing tree. The apply
	 * rung short-circuits (does NOT resolve the sidecar, so the open question
	 * stays surfaced for a human follow-up).
	 */
	| 'refused'
	/**
	 * `answer=merge` + `strictMergeApproval` ON + `main`'s code moved since the
	 * question was asked: the dispatcher RE-SURFACES the merge-question (the
	 * apply rung appends a fresh follow-up asked at the new `main` + re-pauses).
	 */
	| 'restale'
	/** `answer=hold` ⇒ no land; the apply rung records the answer in body as usual. */
	| 'hold'
	/** `answer=drop` ⇒ no land; the apply rung records the answer in body as usual. */
	| 'drop';

/** What the production handler returns to the apply rung. */
export interface MergeActionResult {
	outcome: MergeActionOutcome;
	/** Human-readable summary for the rung's message. */
	message: string;
	/**
	 * The integration-core result, when the dispatcher reached
	 * `performIntegration` (i.e. `answer=merge` + not re-staled). Carries the
	 * routing observed by the land primitive (`gate-failed`, `completed`,
	 * `already-integrated`, …), so callers can branch on it.
	 */
	integration?: IntegrationCoreResult;
	/**
	 * On `restale`: the arbiter `main` the approval was found stale against. The
	 * apply rung records it as the re-surfaced question's `askedAtMain`, so a
	 * re-answer while `main` stays put lands (no re-stale livelock).
	 */
	main?: string;
}

/**
 * The injectable dispatch SEAM. Production wires {@link performMergeAction}
 * (which checks out via `createJob` + lands via `performIntegration`); tests
 * inject a stub to assert the apply-rung short-circuits on `refused` and falls
 * through on `landed` / `hold` / `drop` / `restale` WITHOUT spinning up a real
 * hub mirror.
 */
export type MergeActionHandler = (
	input: MergeActionInput,
) => Promise<MergeActionResult>;

/**
 * Resolve the arbiter URL the land worktree mirrors from. Prefers the
 * caller-supplied `arbiterUrl` (the registry-set advance driver knows it
 * directly); falls back to `git remote get-url <arbiter>` in the apply rung's
 * `cwd` (the in-place / one-shot caller). Returns `undefined` when the URL
 * cannot be resolved — the caller maps that to a clean refusal.
 */
function resolveArbiterUrl(input: MergeActionInput): string | undefined {
	if (input.arbiterUrl !== undefined && input.arbiterUrl !== '') {
		return input.arbiterUrl;
	}
	const res = runProc('git', ['remote', 'get-url', input.arbiter], input.cwd, {
		env: input.env,
	});
	if (res.status !== 0) return undefined;
	const url = res.stdout.trim();
	return url === '' ? undefined : url;
}

/** The verdict of {@link approvedBaseMoved}. */
interface ApprovedBaseCheck {
	/** `main`'s code moved since the answered question was asked ⇒ re-surface. */
	stale: boolean;
	/** The arbiter `main` the check compared against (when it was read). */
	main?: string;
}

/**
 * The `strictMergeApproval` re-stale check (SPEC OQ6 opt-in; task
 * `strict-merge-approval-restale-check-runs-before-the-continue-rebase`): did
 * `main` move since the answered merge question was ASKED? The git-alone
 * analogue of GitHub's "dismiss stale approvals when the base changes".
 *
 * ONE implementation for the laptop dispatcher ({@link performMergeAction}) and
 * the CI agent half ({@link prepareMergeLand}), and both call it BEFORE
 * {@link createJob}, whose continue rebase would otherwise make the kept branch
 * a descendant of the current `main` and hide the move (the bug this replaced).
 *
 * The approved base is the `askedAtMain` the answered entry carries (stamped by
 * the merge-question surfacer, and by the re-surface path with the `main` the
 * follow-up is asked against, so a re-answer while `main` stays put lands and
 * the CI split cannot livelock). It is compared with the arbiter's current
 * `main`, freshly fetched into the hub mirror {@link createJob} then reuses.
 *
 * "Moved" means the tree OUTSIDE `work/` differs: the question, its answer and
 * every other ledger write are commits on `main` under `work/`, so a plain sha
 * compare would re-stale every answer (the answer commit itself moves `main`).
 *
 * Never stale (the cheap default applies) when the entry carries no
 * `askedAtMain` (a sidecar written before it existed) or on any plumbing
 * failure: the red re-verify on the rebased tip stays the load-bearing safety,
 * and a transient git failure must not block a clean answer-then-land.
 */
function approvedBaseMoved(
	url: string,
	input: MergeActionInput,
): ApprovedBaseCheck {
	const asked = input.action.entry.askedAtMain;
	if (asked === undefined) return {stale: false};
	let mirror: EnsureMirrorResult;
	try {
		mirror = ensureMirrorMain({
			url,
			workspacesDir: input.workspacesDir,
			env: input.env,
		});
	} catch {
		return {stale: false};
	}
	const main = mirror.mainSha;
	if (main === asked) return {stale: false, main};
	const diff = runProc(
		'git',
		['diff-tree', '--quiet', '-r', asked, main, '--', ':(exclude)work'],
		mirror.path,
		{env: input.env},
	);
	// 0: no change outside `work/`; 1: changed; anything else: plumbing failure.
	return {stale: diff.status === 1, main};
}

/** The re-stale message both halves report. */
function restaleMessage(input: MergeActionInput, main: string): string {
	const asked = input.action.entry.askedAtMain ?? '(unknown)';
	return (
		`merge-question for ${input.item} answered MERGE, but ` +
		`strictMergeApproval is ON and \`main\` moved since the question was ` +
		`asked (asked at ${asked}, now ${main}): RE-SURFACING the ` +
		`merge-question (no land; the human re-confirms against the new base).`
	);
}

/**
 * The PRODUCTION dispatcher: an answered `kind: merge` entry's verb drives one
 * of the four terminals (`landed` / `refused` / `restale` / `hold|drop`). For
 * `answer=merge` it checks out the unmerged `work/<slug>` via the EXISTING
 * `workspace.ts` per-job worktree seam ({@link createJob}, the same seam the
 * build / recovery callers use) and invokes the LAND primitive
 * ({@link performIntegration}) with `committedRecovery: true` +
 * `freshWorktreeGate: true` — so the rebased tip is re-verified BEFORE it
 * lands, the answered-merge land path NEVER integrates a clean-rebase-but-
 * broken tree, and a refusal routes to needs-attention through the SAME
 * shared seam (`applyNeedsAttentionTransition`) the build path uses. The job
 * worktree is always disposed (success or failure) so the hub mirror does not
 * accumulate stale per-job state.
 *
 * For `answer=hold` and `answer=drop` the dispatcher does not land — it just
 * tells the apply rung to fall through to the normal answer-recording path.
 * (Cancellation of the work branch on `drop` is OUT OF SCOPE; the answer is
 * recorded and a future surfacer / human handles the artifact.)
 */
export async function performMergeAction(
	input: MergeActionInput,
): Promise<MergeActionResult> {
	const note = input.note ?? (() => {});
	const {verb} = input.action;

	// INVARIANT (task `merge-action-nits-followup` nit 4). The merge-question
	// surfacer only emits `kind: merge` sidecars for TASKS, so the hard-coded
	// `type: 'task'` on the `createJob` call below is correct in practice — but
	// if a future surfacer change ever stamps a `kind: merge` sidecar on a
	// non-task item (e.g. a spec-level unmerged branch), the branch name
	// `work/task-<slug>` would silently mis-target. Fail LOUDLY here so the
	// invariant is asserted at the dispatcher's entry rather than manifesting
	// as a mysterious rebase/push mis-target downstream.
	const identity = resolveSidecarIdentity(input.item);
	if (identity.type !== 'task') {
		throw new Error(
			`performMergeAction: sidecar source item \`${input.item}\` has type ` +
				`\`${identity.type}\`, but the answered-merge dispatcher only supports ` +
				`\`task\` items (the surfacer only stamps \`kind: merge\` on tasks; the ` +
				`branch name \`work/task-<slug>\` would silently mis-target otherwise). ` +
				`This is the entry-invariant asserted by nit 4 of task ` +
				`\`merge-action-nits-followup\` — reconcile the surfacer or extend the ` +
				`dispatcher before landing a non-task source item.`,
		);
	}

	if (verb === 'hold') {
		return {
			outcome: 'hold',
			message:
				`merge-question for ${input.item} answered HOLD — leaving \`work/${input.slug}\` ` +
				`unmerged (the answer is recorded in the item body).`,
		};
	}
	if (verb === 'drop') {
		return {
			outcome: 'drop',
			message:
				`merge-question for ${input.item} answered DROP — leaving \`work/${input.slug}\` ` +
				`unmerged (the answer is recorded; cancellation of the work branch is ` +
				`out of this dispatcher's scope).`,
		};
	}

	// verb === 'merge'
	const url = resolveArbiterUrl(input);
	if (url === undefined) {
		return {
			outcome: 'refused',
			message:
				`merge-question for ${input.item} answered MERGE — but the arbiter URL ` +
				`could not be resolved (no arbiterUrl threaded, and \`git remote get-url ` +
				`${input.arbiter}\` failed in ${input.cwd}). NOT landing; the answer ` +
				`stays surfaced.`,
		};
	}

	// STRICT re-stale check (OQ6 opt-in), BEFORE the checkout's continue rebase
	// (which would push the rebased branch, and hide the move): when ON and
	// `main` moved since the question was asked, RE-SURFACE the merge-question
	// (the apply rung folds this into a re-pause) instead of landing. Default
	// OFF ⇒ skipped; the cheap "green re-verify is enough" path runs.
	if (input.strictMergeApproval === true) {
		const check = approvedBaseMoved(url, input);
		if (check.stale && check.main !== undefined) {
			return {
				outcome: 'restale',
				message: restaleMessage(input, check.main),
				main: check.main,
			};
		}
	}

	// Check out the unmerged `work/<type>-<slug>` via the EXISTING per-job
	// worktree seam — the SAME seam build/recovery callers use, NOT a bespoke
	// worktree or clone. The job dir is the worktree `performIntegration` works
	// from; its `arbiterRemote` is the worktree's `origin` (a bare-hub remote
	// that mirrors the real arbiter), which the integration core push-targets.
	let job: Job;
	try {
		job = createJob({
			url,
			slug: input.slug,
			type: 'task',
			workspacesDir: input.workspacesDir,
			env: input.env,
		});
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		return {
			outcome: 'refused',
			message:
				`merge-question for ${input.item} answered MERGE — but checking out ` +
				`\`work/${input.slug}\` via the per-job worktree seam failed (${detail}). ` +
				`NOT landing; the answer stays surfaced.`,
		};
	}

	try {
		// CONTINUE-rebase-conflict: createJob's CONTINUE-rebase aborted (a
		// genuine code conflict, or any other rebase failure, named as such). The
		// kept work stays on the branch (recoverable); we refuse the land and
		// route via the standard refusal shape.
		if (job.continueRebaseConflict) {
			const message =
				`merge-question for ${input.item} answered MERGE — but ` +
				`${continueRebaseSentence(job.branch, job.continueRebaseFailure)} (the kept work is intact on the ` +
				`branch; resolve and re-answer). NOT landing.`;
			note(message);
			return {outcome: 'refused', message};
		}
		if (job.continuePushFailure !== undefined) {
			return {
				outcome: 'refused',
				message:
					`merge-question for ${input.item} answered MERGE — but the ` +
					`continue-rebase push to the arbiter failed (${job.continuePushFailure}). ` +
					`NOT landing; the kept work is intact on the branch.`,
			};
		}

		// LAND through the EXISTING `performIntegration`. The branch's tip
		// already carries its done-move commit (surfacer enumerates `work/*`
		// unreachable from main, so it is a previously-built strand), so we
		// drive the committed-recovery tail — but with `freshWorktreeGate: true`
		// so the REBASED TIP is re-verified BEFORE the integrate (the
		// `committed-recovery-honours-fresh-worktree-gate` task's contract).
		const integration = await performIntegration(
			mergeLandIntegrationInput(job, input, note),
		);

		if (integration.outcome === 'completed') {
			return {
				outcome: 'landed',
				message:
					`merge-question for ${input.item} answered MERGE — landed ` +
					`\`work/${input.slug}\` on \`${job.arbiterRemote}/main\` via the ` +
					`land primitive (rebase → re-verify on the rebased tip → advance).`,
				integration,
			};
		}
		if (integration.outcome === 'already-integrated') {
			return {
				outcome: 'already-integrated',
				message:
					`merge-question for ${input.item} answered MERGE — \`work/${input.slug}\` ` +
					`was already on \`${job.arbiterRemote}/main\` (idempotent re-run).`,
				integration,
			};
		}
		// gate-failed / prepare-failed / review-blocked / review-unparseable /
		// rebase-conflict / sidecar-violation / invariant-violation: the land was REFUSED;
		// performIntegration routed the bounce per its own shared seam (gated by
		// `surfaceArbiter`), so `main` never received a failing tree.
		return {
			outcome: 'refused',
			message:
				integration.reason ??
				`merge-question for ${input.item} answered MERGE — the land was REFUSED ` +
					`(${integration.outcome}); NOT landing; the answer stays surfaced.`,
			integration,
		};
	} finally {
		try {
			job.dispose();
		} catch {
			// Best-effort: a failed dispose leaves a reapable per-job worktree
			// behind, which `gc` cleans up. Never crash the dispatch on teardown.
		}
	}
}

/**
 * The `performIntegration` input of the answered-merge land: the committed-
 * recovery tail (the branch already carries its done-move) with the fresh-
 * worktree gate on the rebased tip, in merge mode. Shared by the laptop
 * dispatcher ({@link performMergeAction}) and the CI agent half
 * ({@link prepareMergeLand}), so both run the SAME rebase and gate.
 */
function mergeLandIntegrationInput(
	job: Job,
	input: MergeActionInput,
	note: (message: string) => void,
): IntegrationCoreInput {
	return {
		cwd: job.dir,
		arbiter: job.arbiterRemote,
		slug: input.slug,
		source: 'tasks-ready',
		recovering: false,
		committedRecovery: true,
		freshWorktreeGate: true,
		prepare: input.prepare,
		verify: input.verify,
		mode: 'merge',
		// surfaceArbiter is set so a RED rebased-tip gate (or a rebase
		// conflict surfaced during the retry loop) routes to needs-attention
		// observably on the arbiter (not local-only). The build path uses
		// this shape; we mirror it here for the answered-merge land.
		surfaceArbiter: job.arbiterRemote,
		recoveryRebaseRetries: input.recoveryRebaseRetries,
		recoveryRebaseJitterMs: input.recoveryRebaseJitterMs,
		mergeRetries: input.mergeRetries,
		env: input.env,
		note,
	};
}

// ---------------------------------------------------------------------------
// The CI agent half (task `ci-split-answered-merge-action`)
// ---------------------------------------------------------------------------

/**
 * What the CI agent job found for an answered `merge` (spec
 * `ci-agent-job-without-write-token` §3, the `apply, kind: merge` row). Each
 * maps to one handoff intent of the `apply` rung:
 *
 *  - `integrate`: the rebased tip passed the fresh-worktree gate; the apply job
 *    pushes it leased and lands it (`integrate`, the rebased tip bundled);
 *  - `restale`: `strictMergeApproval` is on and `main`'s code moved since the
 *    question was asked (`merge-restale`; checked before any checkout);
 *  - `needs-attention`: a red gate on the rebased tip (the rebased tip bundled)
 *    or a rebase conflict (nothing bundled: the kept branch is untouched);
 *  - `already-integrated`: the kept tip is already on `main`; nothing to land
 *    (the lock job's `needsAgent: false` covers this case, so here it means the
 *    branch landed between the lock job and this one).
 */
export type MergeLandPreparation =
	| {kind: 'integrate'; repo: string; workBranch: string; tip: string}
	| {kind: 'restale'; message: string; main: string}
	| {
			kind: 'needs-attention';
			reason: string;
			questions?: string[];
			/** The rebased (red) tip to publish, when there is one. */
			bundle?: {repo: string; workBranch: string};
	  }
	| {kind: 'already-integrated'; message: string};

/** A {@link MergeLandPreparation} and the job worktree it lives in. */
export interface PreparedMergeLand {
	preparation: MergeLandPreparation;
	/** Remove the job worktree; call it once the handoff (and its bundle) is written. */
	dispose(): void;
}

/**
 * The AGENT half of the answered-merge land, for the CI agent job, which holds a
 * read-only token: the SAME optional `strictMergeApproval` re-stale check
 * (before the checkout), checkout ({@link createJob}), rebase and
 * fresh-worktree gate (`prepare` +
 * `verify` run the branch's code) as {@link performMergeAction}, but nothing is
 * written to the arbiter. The continue rebase stays local (decision 7,
 * `localContinue`), and `performIntegration` runs under the phase recorder, so
 * its first write (the land, or the needs-attention route of a red gate) halts
 * it and names what the apply job performs. Only an answered `merge` gets here
 * (`hold` / `drop` need no agent job).
 *
 * The caller writes the handoff from the returned preparation (a bundle reads
 * the job worktree) and then calls `dispose`. Throws when the checkout itself
 * fails (the agent job then fails, and the apply job surfaces the item).
 */
export async function prepareMergeLand(
	answered: MergeActionInput,
): Promise<PreparedMergeLand> {
	// The job worktree lives in the hub mirror, which does not see the
	// checkout's local git config, where the CI workflow sets the identity: the
	// continue rebase (and the wip commit of a red gate) need it
	// (`withCheckoutCommitIdentity`).
	const input: MergeActionInput = {
		...answered,
		env: withCheckoutCommitIdentity(answered.cwd, answered.env),
	};
	const note = input.note ?? (() => {});
	const identity = resolveSidecarIdentity(input.item);
	if (identity.type !== 'task' || input.action.verb !== 'merge') {
		throw new Error(
			`prepareMergeLand: only an answered merge of a task is prepared ` +
				`(got ${input.item}, answer ${input.action.verb})`,
		);
	}
	const url = resolveArbiterUrl(input);
	if (url === undefined) {
		throw new Error(
			`the arbiter URL of ${input.item} could not be resolved (\`git remote ` +
				`get-url ${input.arbiter}\` failed in ${input.cwd})`,
		);
	}
	// The re-stale check runs BEFORE the (local) continue rebase, exactly as on
	// the laptop: the same `approvedBaseMoved`.
	if (input.strictMergeApproval === true) {
		const check = approvedBaseMoved(url, input);
		if (check.stale && check.main !== undefined) {
			const main = check.main;
			return {
				preparation: {
					kind: 'restale',
					message: restaleMessage(input, main),
					main,
				},
				dispose: () => {},
			};
		}
	}
	const job = createJob({
		url,
		slug: input.slug,
		type: 'task',
		workspacesDir: input.workspacesDir,
		localContinue: true,
		env: input.env,
	});
	const dispose = (): void => {
		try {
			job.dispose();
		} catch {
			// Best-effort, as in performMergeAction: `gc` reaps a leftover.
		}
	};
	const prepared = (preparation: MergeLandPreparation): PreparedMergeLand => ({
		preparation,
		dispose,
	});
	try {
		if (job.continueRebaseConflict) {
			const reason =
				`${continueRebaseSentence(job.branch, job.continueRebaseFailure)}; the kept work is intact on the ` +
				'branch. Resolve it, then answer the merge question again.';
			note(reason);
			return prepared({kind: 'needs-attention', reason});
		}
		const outcome = await runAgentPhase(
			createPhaseRecorder({
				record: [
					'ledgerWrite.applyCompleteTransition',
					'ledgerWrite.applyNeedsAttentionTransition',
				],
			}),
			() => performIntegration(mergeLandIntegrationInput(job, input, note)),
		);
		if (outcome.halted) {
			const call = `${outcome.intent.seam}.${outcome.intent.method}`;
			if (call === 'ledgerWrite.applyCompleteTransition') {
				fetchKeptLfsObjects(job, input.env, note);
				const tip = runProc('git', ['rev-parse', 'HEAD'], job.dir, {
					env: input.env,
				}).stdout.trim();
				return prepared({
					kind: 'integrate',
					repo: job.dir,
					workBranch: job.branch,
					tip,
				});
			}
			// A red gate (or prepare) on the rebased tip: the route's local half
			// (the wip commit) runs here, so the rebased tip travels in the bundle.
			const routed = outcome.intent.input as {
				reason: string;
				questions?: string[];
			};
			commitAbortedWork({cwd: job.dir, slug: input.slug, env: input.env});
			fetchKeptLfsObjects(job, input.env, note);
			return prepared({
				kind: 'needs-attention',
				reason: routed.reason,
				...(routed.questions === undefined
					? {}
					: {questions: routed.questions}),
				bundle: {repo: job.dir, workBranch: job.branch},
			});
		}
		const result = outcome.result;
		if (result.outcome === 'already-integrated') {
			return prepared({
				kind: 'already-integrated',
				message: result.reason ?? `work/task-${input.slug} is already on main`,
			});
		}
		// A rebase conflict on every attempt (or an invariant violation): nothing
		// was written and the kept branch is untouched on the arbiter.
		return prepared({
			kind: 'needs-attention',
			reason:
				result.reason ??
				`the answered merge of ${input.item} ended as ${result.outcome}`,
		});
	} catch (err) {
		dispose();
		throw err;
	}
}

/**
 * Bring into the job's local LFS store the objects of every LFS pointer the
 * kept commits (`HEAD ^<origin>/main`) add or change, so the handoff carries
 * them (`writeLfsObjects` copies from that store) and the apply job pushes them
 * before the branch (decision 6). The kept branch was built elsewhere, so its
 * objects live on the arbiter's LFS store, not in this fresh job: a read-only
 * `git lfs fetch` of those commits. Best-effort: an object still missing is
 * reported by the handoff writer, and the apply job then rejects the handoff
 * and surfaces the item.
 */
function fetchKeptLfsObjects(
	job: Job,
	env: NodeJS.ProcessEnv | undefined,
	note: (message: string) => void,
): void {
	const commits = runProc(
		'git',
		['rev-list', 'HEAD', `^refs/remotes/${job.arbiterRemote}/main`],
		job.dir,
		{env},
	)
		.stdout.split('\n')
		.filter((l) => l !== '');
	if (commits.length === 0) return;
	const {pointers} = scanLfsPointers({
		cwd: job.dir,
		blobs: changedFileBlobs(job.dir, commits, env),
		env,
	});
	if (pointers.length === 0) return;
	const store = localLfsObjectsDir(job.dir, env);
	const missing = pointers.some((p) => {
		const path = lfsObjectPath(store, p.oid);
		return !existsSync(path) || !statSync(path).isFile();
	});
	if (!missing) return;
	const fetched = runProc(
		'git',
		['lfs', 'fetch', job.arbiterRemote, ...commits],
		job.dir,
		{env},
	);
	if (fetched.status !== 0) {
		note(
			`git lfs fetch of the kept commits failed (${fetched.stderr.trim().slice(0, 300)}); ` +
				'the handoff will lack their LFS objects',
		);
	}
}
