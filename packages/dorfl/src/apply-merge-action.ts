import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
	allAnswered,
	isEntryAnswered,
	parseSidecar,
	sidecarPathFor,
	type SidecarEntry,
	type SidecarModel,
} from './sidecar.js';
import {run as runProc} from './git.js';
import {createJob, type Job} from './workspace.js';
import {
	performIntegration,
	type IntegrationCoreResult,
} from './integration-core.js';
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
 * the merge-question instead of landing when the merge-base moved between the
 * surfacer's question and this apply. The RED-re-verify refusal is unchanged
 * in both modes.
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

/** The three deterministic actions a merge-question answer encodes. */
export type MergeActionVerb = 'merge' | 'hold' | 'drop';

/** A detected, answer-driven merge-action keyed off ONE answered `kind: merge` entry. */
export interface DetectedMergeAction {
	/** The deterministic verb parsed from the entry's answer text. */
	verb: MergeActionVerb;
	/** The answered `kind: merge` entry the verb came from. */
	entry: SidecarEntry;
}

/**
 * Parse the human's plain free-text answer into the deterministic
 * {@link MergeActionVerb}. The merge-question surfacer renders
 * `merge | hold | drop` in the entry's `default` as a human-readable hint, so
 * the human typically types one of those words verbatim. We accept any text
 * whose first whole word (case-insensitive) is one of `merge` / `hold` / `drop`
 * — this is the same machine-parseable choice shape the surfacer's applied
 * answer q1 documents ("a DETERMINISTIC CHOICE shape … the human picks and the
 * system parses unambiguously").
 *
 * Returns `undefined` on ANYTHING else (an empty answer, a typo, a long
 * narrative without one of the three words at the start) so the caller can
 * route the ambiguity HONESTLY — never default-to-merge on a malformed answer,
 * which would invent a land the human did not authorise.
 */
export function parseMergeAnswer(text: string): MergeActionVerb | undefined {
	const trimmed = text.trim().toLowerCase();
	if (trimmed === '') return undefined;
	// The first whole alphabetic word; trailing punctuation (a comma, em-dash,
	// period) and any following commentary are tolerated. We deliberately do
	// NOT consume hyphens / apostrophes — the three verbs are plain ASCII
	// words, and over-tolerating typo-shapes would silently invent a verb the
	// human did not pick.
	const match = /^([a-z]+)/.exec(trimmed);
	if (match === null) return undefined;
	const word = match[1];
	if (word === 'merge' || word === 'hold' || word === 'drop') {
		return word;
	}
	return undefined;
}

/**
 * Detect the FIRST answered `kind: merge` entry's deterministic action verb in
 * a fully-answered sidecar (the apply rung's pre-decider kind-check). Returns
 * `undefined` when the sidecar carries no answered `kind: merge` entry (the
 * apply rung then proceeds to the existing path — agentic for observations,
 * normal apply for task/spec content questions).
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
	if (!allAnswered(model)) return undefined;
	for (const entry of model.entries) {
		if (entry.kind !== 'merge') continue;
		if (!isEntryAnswered(entry)) continue;
		const verb = parseMergeAnswer(entry.answer);
		if (verb !== undefined) {
			return {verb, entry};
		}
	}
	return undefined;
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
	 * merge-question when the merge-base moved between the surfacer's question
	 * and this apply (don't land; the apply rung folds this into a re-pause).
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
	 * `answer=merge` + `strictMergeApproval` ON + the merge-base moved between
	 * the surfacer's question and this apply: the dispatcher RE-SURFACES the
	 * merge-question (the apply rung appends a fresh follow-up + re-pauses).
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

/**
 * The `strictMergeApproval` re-stale check (SPEC OQ6 opt-in): did `<arbiter>/
 * main` move past the merge-base of the work branch since the surfacer
 * authored the question? The git-alone analogue of GitHub's "dismiss stale
 * approvals when the base changes" — host-agnostic by reachability.
 *
 * We fetch the latest `<arbiter>/main` from the JOB worktree's hub mirror (the
 * worktree's `origin`), compute `merge-base(<branch>, <origin/main>)`, and
 * compare against `<origin/main>` itself: if the merge-base IS `<origin/main>`,
 * the branch is a strict descendant — the merge-base did NOT move — and the
 * cheap default applies (HONOUR + land on green re-verify). If the merge-base
 * is NOT `<origin/main>`, `main` advanced past the branch's divergence point
 * since the branch was last rebased — the merge-base MOVED — and the strict
 * mode re-surfaces.
 *
 * Returns `true` when the merge-base moved (⇒ re-surface), `false` otherwise.
 * On any plumbing failure returns `false` (do NOT spuriously re-surface — the
 * red re-verify is still the load-bearing safety; a transient git failure must
 * not block a clean answer-then-land).
 */
function mergeBaseMoved(job: Job, env: NodeJS.ProcessEnv | undefined): boolean {
	const fetch = runProc(
		'git',
		[
			'fetch',
			'--quiet',
			job.arbiterRemote,
			`+refs/heads/main:refs/remotes/${job.arbiterRemote}/main`,
		],
		job.dir,
		{env},
	);
	if (fetch.status !== 0) return false;
	const mainRef = `${job.arbiterRemote}/main`;
	const mainSha = runProc(
		'git',
		['rev-parse', '--verify', '--quiet', mainRef],
		job.dir,
		{env},
	);
	if (mainSha.status !== 0) return false;
	const base = runProc('git', ['merge-base', 'HEAD', mainRef], job.dir, {env});
	if (base.status !== 0) return false;
	return base.stdout.trim() !== mainSha.stdout.trim();
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
		// CONTINUE-rebase-conflict: createJob's CONTINUE-rebase aborted on a
		// genuine code conflict. The kept work stays on the branch (recoverable);
		// we refuse the land and route via the standard refusal shape.
		if (job.continueRebaseConflict) {
			return {
				outcome: 'refused',
				message:
					`merge-question for ${input.item} answered MERGE — but rebasing ` +
					`\`work/${input.slug}\` onto current main conflicted (the kept work is ` +
					`intact on the branch; resolve and re-answer). NOT landing.`,
			};
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

		// STRICT re-stale check (OQ6 opt-in): when ON and the merge-base moved
		// between the surfacer's question and this apply, RE-SURFACE the
		// merge-question (the apply rung folds this into a re-pause) instead of
		// landing. Default OFF ⇒ this block is skipped; the cheap "green
		// re-verify is enough" path runs.
		if (input.strictMergeApproval === true && mergeBaseMoved(job, input.env)) {
			return {
				outcome: 'restale',
				message:
					`merge-question for ${input.item} answered MERGE — but ` +
					`strictMergeApproval is ON and the merge-base of \`work/${input.slug}\` ` +
					`moved between answer and apply: RE-SURFACING the merge-question ` +
					`(no land; the human re-confirms against the new base).`,
			};
		}

		// LAND through the EXISTING `performIntegration`. The branch's tip
		// already carries its done-move commit (surfacer enumerates `work/*`
		// unreachable from main, so it is a previously-built strand), so we
		// drive the committed-recovery tail — but with `freshWorktreeGate: true`
		// so the REBASED TIP is re-verified BEFORE the integrate (the
		// `committed-recovery-honours-fresh-worktree-gate` task's contract).
		const integration = await performIntegration({
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
		});

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
		// rebase-conflict / invariant-violation: the land was REFUSED;
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
