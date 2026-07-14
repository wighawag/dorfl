import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
	isEntryAnswered,
	parseSidecar,
	sidecarPathFor,
	type SidecarEntry,
	type SidecarModel,
} from './sidecar.js';
import {deleteRemoteWorkBranchIfPresent} from './needs-attention.js';

/**
 * The **answered STUCK-QUESTION ACTION DISPATCH** (spec
 * `surface-stuck-as-questions-and-retire-stuck-lock-state`, task
 * `apply-resolve-reset-flag-discards-work-branch`; user story 2, resolved
 * decision #6) — the deterministic, answer-driven RUNNER-ACTION layer that
 * turns an answered `kind: 'stuck'` sidecar entry (the shape the bounce-surface
 * path stamps when a task's build bounces) into one of three verbs:
 *
 *   - `keep`   -> today's continue-from-WIP: leave the `work/<slug>` branch
 *                alone; the apply rung falls through to the normal
 *                `applyAnsweredQuestions` resolve so the next claim continues
 *                from the branch tip.
 *   - `reset`  -> discard the WIP branch, rebuild clean: DELETE the remote
 *                `work/<slug>` branch on the arbiter (via the SHARED
 *                {@link deleteRemoteWorkBranchIfPresent} primitive the
 *                `requeue --reset` recovery verb also uses) BEFORE the apply
 *                rung clears `needsAnswers`, so the next claim starts fresh.
 *                Safely IDEMPOTENT when no branch exists (an observation, or a
 *                task never built) — a `remote ref does not exist` push error
 *                is tolerated as an already-gone no-op.
 *   - `cancel` -> the existing `dispose` terminal: `git mv` the task to
 *                `tasks/cancelled/` via `applyAnsweredQuestions`' `dispose`
 *                option (the answer text is recorded as the human's reason).
 *
 * A direct SIBLING of the `apply-merge-action.ts` machinery: the apply rung
 * KIND-CHECKS the sidecar BEFORE the fall-through persist, so an answered
 * `kind: 'stuck'` entry dispatches HERE deterministically (mirroring how a
 * `kind: 'merge'` entry dispatches through `apply-merge-action.ts`). There is
 * NO agentic decider on the TASK apply-persist path (the `runAgenticDecision`
 * gate at `advance.ts` fires only for `namespace === 'observation'`), so this
 * MUST be a deterministic parse+dispatch — the flag SOURCE on the task path
 * (see the task's `## Re-scope 2026-07-14`).
 *
 * # Ordering (delete-before-clear) and partial-failure decision
 *
 * The `reset` verb DELETES the remote work branch BEFORE the apply rung
 * clears `needsAnswers`. On a partial failure (arbiter delete FAILS after the
 * local tracking ref was cleared), we REFUSE the apply and leave the sidecar
 * in place (`needsAnswers` stays `true`), so the human sees the failure and
 * can re-answer. The alternative (clear-then-delete, or clear-anyway on a
 * failed delete) would leave the item `needsAnswers:false` and CLAIMABLE while
 * still carrying the WIP branch we meant to discard — exactly the stale-
 * continue trap the `requeue --reset` code path spends a page of comment
 * defending against. The two callers (this verb + `requeue --reset`) MUST
 * stay behaviourally identical; both fail the whole recovery on a genuine
 * push-delete failure. This is the `## Decisions` entry the done record
 * links.
 */

/** The three deterministic verbs a stuck-question answer encodes. */
export type StuckActionVerb = 'keep' | 'reset' | 'cancel';

/** A detected, answer-driven stuck-action keyed off ONE answered `kind: 'stuck'` entry. */
export interface DetectedStuckAction {
	/** The deterministic verb parsed from the entry's answer text. */
	verb: StuckActionVerb;
	/** The answered `kind: 'stuck'` entry the verb came from. */
	entry: SidecarEntry;
}

/**
 * Parse the human's plain free-text answer into a {@link StuckActionVerb}.
 * MIRRORS `parseMergeAnswer` EXACTLY: first whole ASCII word, case-insensitive,
 * trailing commentary tolerated; `undefined` on anything else (empty / typo /
 * narrative). NEVER default-guesses a destructive `reset` — an ambiguous
 * answer falls through to today's plain persist (the safe "keep the branch,
 * clear the flag" behaviour), never invents a branch discard.
 */
export function parseStuckAnswer(text: string): StuckActionVerb | undefined {
	const trimmed = text.trim().toLowerCase();
	if (trimmed === '') return undefined;
	const match = /^([a-z]+)/.exec(trimmed);
	if (match === null) return undefined;
	const word = match[1];
	if (word === 'keep' || word === 'reset' || word === 'cancel') {
		return word;
	}
	return undefined;
}

/**
 * Detect the `kind: 'stuck'` action verb that should drive the next apply run.
 *
 * ORDERING (mirrors `detectAnsweredMergeAction`'s re-stale re-surface rule):
 *
 *   1. If ANY `kind: 'stuck'` entry is UNANSWERED, return `undefined` —
 *      that is the re-paused state (a freshly-appended follow-up awaiting an
 *      answer), and the apply MUST NOT fire against a stale prior sibling.
 *   2. Otherwise return the LATEST answered `kind: 'stuck'` entry — a fresh
 *      follow-up answer wins over the stale one.
 *
 * Returns `undefined` on a missing/unparseable sidecar or when no
 * `kind: 'stuck'` entry parses to one of the three verbs (the apply rung then
 * falls through to today's plain persist, which is the `keep` semantic — a
 * malformed answer NEVER discards a branch).
 */
export function detectAnsweredStuckAction(
	cwd: string,
	item: string,
): DetectedStuckAction | undefined {
	const abs = join(cwd, sidecarPathFor(item));
	if (!existsSync(abs)) return undefined;
	let model: SidecarModel;
	try {
		model = parseSidecar(readFileSync(abs, 'utf8'));
	} catch {
		return undefined;
	}
	for (const entry of model.entries) {
		if (entry.kind === 'stuck' && !isEntryAnswered(entry)) return undefined;
	}
	for (let i = model.entries.length - 1; i >= 0; i--) {
		const entry = model.entries[i];
		if (entry.kind !== 'stuck') continue;
		if (!isEntryAnswered(entry)) continue;
		const verb = parseStuckAnswer(entry.answer);
		if (verb !== undefined) {
			return {verb, entry};
		}
	}
	return undefined;
}

/** Input the production stuck-action handler consumes. */
export interface StuckActionInput {
	/** The detected action (verb + source entry). */
	action: DetectedStuckAction;
	/** The namespaced item identity (`task:<slug>`). */
	item: string;
	/** The bare slug (the work branch is `work/task-<slug>`). */
	slug: string;
	/** The apply rung's working clone. */
	cwd: string;
	/** The arbiter remote NAME in `cwd` (defaults to `origin`). */
	arbiter: string;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

/** The terminal verbs the dispatcher reports to the apply rung. */
export type StuckActionOutcome =
	/** `answer=keep` -> no action; fall through to the normal apply persist. */
	| 'keep'
	/**
	 * `answer=reset` -> the remote `work/<slug>` branch was DELETED (or was
	 * already gone); fall through to the normal apply persist so
	 * `needsAnswers` clears. The `already-gone` sub-case is the safe idempotent
	 * no-op for an item with no work branch.
	 */
	| 'reset'
	/**
	 * `answer=cancel` -> the apply rung dispatches through
	 * `applyAnsweredQuestions`' `dispose` option (task -> `tasks/cancelled/`).
	 * The answer text is the human's reason.
	 */
	| 'cancel'
	/**
	 * `answer=reset` -> the branch delete FAILED (a real push-delete error, not
	 * `already-gone`). The apply rung SHORT-CIRCUITS: the sidecar stays,
	 * `needsAnswers` stays `true`, no clear — the human sees the failure and
	 * re-answers. Matches the `requeue --reset` "abort the requeue on a failed
	 * arbiter delete" behaviour (delete-before-clear ordering, see the module
	 * docs' partial-failure decision).
	 */
	| 'refused';

/** What the production handler returns to the apply rung. */
export interface StuckActionResult {
	outcome: StuckActionOutcome;
	/** Human-readable summary for the rung's message. */
	message: string;
}

/**
 * The injectable dispatch SEAM. Production wires {@link performStuckAction};
 * tests inject a stub to assert on the apply-rung's routing WITHOUT touching a
 * real arbiter.
 */
export type StuckActionHandler = (
	input: StuckActionInput,
) => Promise<StuckActionResult>;

/**
 * The PRODUCTION dispatcher: an answered `kind: 'stuck'` entry's verb drives
 * one of the four terminals (`keep` / `reset` / `refused` / `cancel`). For
 * `answer=reset` it dispatches through the SHARED
 * {@link deleteRemoteWorkBranchIfPresent} primitive the `requeue --reset` verb
 * also uses — delete-before-clear ordering, local-first write-through,
 * already-gone tolerance (safe no-op when no branch exists). For `keep` and
 * `cancel` there is nothing to do on the git side; the apply rung's normal
 * fall-through handles the persist (`cancel` via the `dispose` option).
 */
export async function performStuckAction(
	input: StuckActionInput,
): Promise<StuckActionResult> {
	const note = input.note ?? (() => {});
	const {verb} = input.action;

	if (verb === 'keep') {
		return {
			outcome: 'keep',
			message:
				`stuck-question for ${input.item} answered KEEP — leaving ` +
				`\`work/task-${input.slug}\` untouched (continue-from-WIP; the answer ` +
				`is recorded in the item body via the normal apply path).`,
		};
	}

	if (verb === 'cancel') {
		return {
			outcome: 'cancel',
			message:
				`stuck-question for ${input.item} answered CANCEL — dispatching ` +
				`through the \`dispose\` terminal (\`git mv -> tasks/cancelled/\`).`,
		};
	}

	// verb === 'reset'
	const dropped = await deleteRemoteWorkBranchIfPresent({
		cwd: input.cwd,
		arbiter: input.arbiter,
		slug: input.slug,
		env: input.env,
	});
	if (dropped.status === 'failed') {
		const stderr = dropped.stderr;
		const message =
			`stuck-question for ${input.item} answered RESET — but the arbiter ` +
			`delete of ${dropped.branch} on ${input.arbiter} failed ` +
			`(${stderr || 'unknown error'}). NOT clearing needsAnswers; the sidecar ` +
			`stays surfaced for a re-answer. The local tracking ref was already ` +
			`cleared (write-through ordering); a subsequent fetch will restore it ` +
			`from the arbiter — the local store is BEHIND the arbiter ` +
			`(self-healing), never AHEAD (which would drive a stale continue).`;
		note(message);
		return {outcome: 'refused', message};
	}
	const droppedLabel =
		dropped.status === 'deleted'
			? `Deleted the remote branch ${dropped.branch} on ${input.arbiter}`
			: `Remote branch ${dropped.branch} on ${input.arbiter} was already gone`;
	const message =
		`stuck-question for ${input.item} answered RESET — ${droppedLabel} ` +
		`(next claim starts fresh).`;
	note(message);
	return {outcome: 'reset', message};
}
