import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {run, type RunResult} from './git.js';
import {applyAtomic, type ApplyAtomicResult} from './sidecar-apply.js';
import {
	allAnswered,
	appendQuestions,
	parseSidecar,
	sidecarPathFor,
	type NewQuestion,
	type SidecarEntry,
	type SidecarModel,
} from './sidecar.js';
import {
	APPLY_LIFECYCLE_FOLDERS,
	resolveItemPathByIdentity,
} from './item-path.js';

/**
 * The engine-owned APPLY PERSIST (prd `advance-loop`, task `advance-rung-apply`;
 * AGENTIC apply, task `agentic-apply-retire-disposition-vocabulary`) — the half of
 * the APPLY rung the ENGINE owns. On `classify=apply` (ALL sidecar entries
 * answered), it applies the HUMAN's answers to the item ATOMICALLY (item body +
 * sidecar in ONE commit, via the sidecar contract's {@link applyAtomic}), then
 * EITHER:
 *
 *   - **append / re-pause** — when the apply has NEW questions to ask: append
 *     `qN+1…`, stay `needsAnswers:true`, re-pause (the "all answered?" flips back
 *     to false); OR
 *   - **discharge by deletion** — when the caller decided the SOURCE should leave
 *     by deletion (`discharge` set): `git rm` the source + sidecar in a STANDALONE
 *     revertible commit, the reason in the commit message (git history is the
 *     archive); OR
 *   - **resolve fully** (the default) — clear `needsAnswers` + DELETE the sidecar
 *     in the SAME atomic commit (the invariant `needsAnswers:false ⟺ no active
 *     sidecar`); the item advances toward build by its normal lifecycle.
 *
 * **The disposition vocabulary is GONE** (task
 * `agentic-apply-retire-disposition-vocabulary`): the apply rung no longer reads a
 * per-entry `disposition=` token, no longer runs a most-decisive picker, and has
 * no `keep`/`triaged:keep` resting state. A sidecar entry is BINARY (no-answer |
 * answered); what to DO with a fully-answered OBSERVATION is decided by the
 * AGENTIC apply decision in the advance tick (`advance.ts` `applyRung` over the
 * shared `decide` engine), which then routes here (re-pause / discharge / via
 * `promoteObservation` for a mint). A signal is still-open, acted-on, or deleted
 * — there is no \"retain as resolved\" state.
 *
 * The work-item (task/prd) terminal MOVES (`tasks/cancelled`, `prds/dropped`) and
 * the `needs-attention/` LIFECYCLE state are a SEPARATE lifecycle concern (a
 * task/prd is dropped by its own lifecycle, not by a question answer) — they are
 * NOT routed from here any more (they were the removed disposition vocabulary).
 *
 * It is the SIBLING of {@link import('./surface-persist.js').persistSurfacedQuestions}:
 * that is the SURFACE rung's one-commit primitive (append-or-create + set
 * `needsAnswers`); this is the APPLY rung's (apply answers + resolve / re-pause /
 * discharge). Kept file-orthogonal so the rung bodies land in different tasks.
 *
 * **NEVER invents an answer (US #4).** The apply rung applies ONLY what the human
 * authored — the recorded `answer:` text. It does NOT fill, guess, or author an
 * answer; a SUBSET-answered sidecar is not even classified `apply` (the classifier
 * NO-OPs), so this is only ever called with a fully-answered sidecar. **ALWAYS
 * allowed (no gate)** — applying a human's answer is never gated, even with every
 * autonomy flag off (the engine, not this module, enforces the no-gate
 * sequencing).
 *
 * Like the surface persist, this is the LOCAL one-commit primitive over a working
 * tree (the throwaway-git-repo test pattern). The `advancing` CAS lock that makes
 * it WINNER-ONLY is held by `performAdvance` BEFORE this is called; this module
 * does NOT race the arbiter — that is the lock's job.
 */

// Re-export the extracted neutral resolver so existing importers of
// `apply-persist.ts` keep working (the resolver now LIVES in `item-path.ts`, a
// non-hot module the sibling CLI / gc-sweep tasks import without touching this
// rewritten file).
export {APPLY_LIFECYCLE_FOLDERS, resolveItemPathByIdentity};

/** Marker that opens the applied-answers record in an item body. */
const APPLIED_HEADING = '## Applied answers';

/**
 * The STRUCTURAL fence the templates wrap the transient open-questions block in
 * — an HTML-comment marker pair, mirroring the existing `<!-- dorfl-…
 * -->` style in `sidecar.ts`. Apply's reconcile (full-resolution route only)
 * strips everything between the OPEN and CLOSE markers (inclusive) when it folds
 * answers in and clears `needsAnswers`, so the resolved item body reads as
 * resolved (no leftover "these are still open" prose above `## Applied answers`).
 *
 * The strip is STRUCTURAL (marker-pair based), NOT a heading-text regex — the
 * prd's D1 decision: a `## Open questions` heading match would be fragile to
 * author wording (`## Open questions (clear needsAnswers when resolved)` vs.
 * `## Open questions`). Items authored WITHOUT the markers are left untouched
 * (backward compat — no marker ⇒ nothing to strip ⇒ identical bytes).
 *
 * The sibling task `templates-mark-transient-open-questions-block` introduces
 * the markers in the prd/task templates; this task exports the constants so
 * the two tasks agree on the literal byte sequence.
 */
export const OPEN_QUESTIONS_MARKER_OPEN = '<!-- open-questions -->';
export const OPEN_QUESTIONS_MARKER_CLOSE = '<!-- /open-questions -->';

export interface ApplyAnsweredQuestionsOptions {
	/** Working clone/worktree the apply commits in. */
	cwd: string;
	/** The namespaced item identity (`task:foo` / `prd:bar` / `observation:baz`). */
	item: string;
	/**
	 * The item file path RELATIVE to `cwd` (e.g. `work/backlog/foo.md`). The
	 * sidecar path is derived from the identity, NOT from this path (identity-keyed,
	 * folder-agnostic). The apply rewrites THIS file + the sidecar and commits them
	 * together.
	 */
	itemPath: string;
	/**
	 * NEW follow-up questions the apply has (the agentic `ask-follow-up` verdict, or
	 * a caller-supplied batch). When non-empty, the apply APPENDS them (`qN+1…`,
	 * never mutating an answered entry) and RE-PAUSES (`needsAnswers:true` stays) —
	 * the "all answered?" flips back to false. Empty/omitted ⇒ resolve the item (or
	 * discharge it, when `discharge` is set).
	 */
	appendQuestions?: NewQuestion[];
	/**
	 * DISCHARGE the SOURCE by DELETION (the agentic `delete-source` verdict, or a
	 * direct discharge): instead of resolving in place, `git rm` the source + its
	 * answered sidecar in a STANDALONE revertible commit, the `reason` recorded in
	 * the commit message (git history is the archive). Fires DIRECT (no
	 * preview/confirm — decision 12). Mutually exclusive with `appendQuestions`
	 * (re-pause and discharge cannot both happen on one apply); when both are given
	 * the re-pause wins (you cannot discharge a source you are still asking about).
	 */
	discharge?: {reason: string};
	/** Advisory committer id for the commit subject. Defaults to git user.name. */
	by?: string;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

/** The terminal an apply reached. */
export type ApplyTerminal =
	/** Resolved fully: needsAnswers cleared + sidecar deleted (the default). */
	| 'resolved'
	/** New questions appended; stayed needsAnswers:true and re-paused. */
	| 'repaused'
	/**
	 * The SOURCE was DISCHARGED BY DELETION (the agentic `delete-source` verdict, or
	 * a direct discharge): the source (+ its answered sidecar) were `git rm`-ed in a
	 * STANDALONE revertible commit, the reason recorded in the commit message (git
	 * history = archive). A discharged item leaves by being GONE — there is no
	 * resting marker. This is the apply rung applying the human's RATIFIED answer
	 * (human-authored, not a unilateral agent destruction of a live signal).
	 */
	| 'deleted'
	/**
	 * The item file was GONE by the time apply tried to write (a concurrent
	 * promote/terminal-move/delete between capture and write). Apply exited
	 * CLEAN: no commit, no ghost file at the stale path. The matching benign
	 * skip the surface/triage rungs already use (`advance.ts` `vanishedSkip`),
	 * extended into the apply rung by the F3a folder-agnostic resolver.
	 */
	| 'vanished';

export interface ApplyAnsweredQuestionsResult {
	/** The terminal the apply reached. */
	outcome: ApplyTerminal;
	/** The commit sha the apply produced. */
	commit?: string;
	/** The sidecar path (relative to `cwd`) the apply touched. */
	sidecarPath: string;
	/** The item path (relative to `cwd`) after the apply. */
	itemPath: string;
	/** A human-readable summary. */
	message: string;
}

/** Raised for usage errors (a missing repo, an unreadable item, a subset apply). */
export class ApplyPersistError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ApplyPersistError';
	}
}

function gitSoft(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): RunResult {
	return run('git', args, cwd, {env});
}

function gitHard(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): RunResult {
	const result = run('git', args, cwd, {env});
	if (result.status !== 0) {
		throw new ApplyPersistError(
			`git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr.trim()}`,
		);
	}
	return result;
}

function resolveBy(cwd: string, env: NodeJS.ProcessEnv | undefined): string {
	const name = gitSoft(['config', 'user.name'], cwd, env);
	if (name.status === 0 && name.stdout.trim() !== '') {
		return name.stdout.trim();
	}
	const e = env ?? process.env;
	return e.USER ?? e.USERNAME ?? '';
}

/** Read the item body from the tree (committed) then the working-tree file. */
function readItem(
	itemAbs: string,
	cwd: string,
	itemPath: string,
	env: NodeJS.ProcessEnv | undefined,
): string {
	const show = gitSoft(['show', `:${itemPath}`], cwd, env);
	if (show.status === 0) {
		return show.stdout;
	}
	try {
		return readFileSync(itemAbs, 'utf8');
	} catch {
		throw new ApplyPersistError(
			`cannot read item body for '${itemPath}' (the apply rung needs the item file)`,
		);
	}
}

/** Read + parse the existing sidecar (from the working file). */
function readSidecar(
	cwd: string,
	item: string,
): {model: SidecarModel; path: string} {
	const path = sidecarPathFor(item);
	const abs = join(cwd, path);
	if (!existsSync(abs)) {
		throw new ApplyPersistError(
			`no sidecar at ${path} for ${item} — the apply rung needs an answered sidecar`,
		);
	}
	return {model: parseSidecar(readFileSync(abs, 'utf8')), path};
}

/**
 * Render the applied-answers record appended to the item body. PURELY the human's
 * recorded answers (verbatim) under a dated heading — NEVER an invented or
 * paraphrased answer. Append-only (a prior record stays); the body is the durable
 * home of what the human decided.
 */
function appliedAnswersBlock(entries: SidecarEntry[]): string {
	const date = new Date().toISOString().slice(0, 10);
	const lines: string[] = ['', `${APPLIED_HEADING} ${date}`, ''];
	for (const entry of entries) {
		lines.push(`### ${entry.id}: ${entry.question.trim()}`);
		lines.push('');
		lines.push(entry.answer.trim());
		lines.push('');
	}
	return lines.join('\n');
}

/** Append the applied-answers record to an item body (append-only). */
function withAppliedAnswers(body: string, entries: SidecarEntry[]): string {
	const base = body.replace(/\s*$/, '');
	return `${base}\n${appliedAnswersBlock(entries)}`;
}

/**
 * Strip ALL marker-fenced open-questions blocks from an item body — the FULL
 * RESOLUTION reconcile step (prd `apply-reconciles-stale-open-questions`,
 * decisions D1 / D3). Removes each `<!-- open-questions -->` … `<!--
 * /open-questions -->` pair (markers included) plus the blank lines that
 * flanked it, so the answers in `## Applied answers` no longer sit beneath a
 * stale "these are still open" section.
 *
 * Behavioural choices (recorded in the done note):
 *   - strips EVERY well-formed marker pair, not just the first (an authoring
 *     template may legitimately fence more than one transient block — e.g.
 *     open-questions plus an autonomy-note — and partial strips would re-create
 *     the same drift the reconcile exists to prevent);
 *   - FAIL-SAFE on a malformed fence (a lone opener with no matching closer):
 *     the regex simply doesn't match, the body is returned unchanged. A
 *     fail-loud throw would block the apply commit on a template authoring bug;
 *     leaving the body intact preserves the answer-application invariant and
 *     surfaces the stale block to a human reviewer instead;
 *   - collapses runs of 3+ newlines down to 2 after a strip, so removing a
 *     block doesn't leave a triple-blank gap between the surrounding paragraphs.
 *
 * Called ONLY from the full-resolution path. The re-pause path (follow-up
 * questions appended, `needsAnswers` stays true) NEVER calls this — the
 * open-questions block is still legitimately open there (D3).
 */
function stripOpenQuestionsBlocks(body: string): string {
	const escOpen = OPEN_QUESTIONS_MARKER_OPEN.replace(
		/[.*+?^${}()|[\]\\]/g,
		'\\$&',
	);
	const escClose = OPEN_QUESTIONS_MARKER_CLOSE.replace(
		/[.*+?^${}()|[\]\\]/g,
		'\\$&',
	);
	const re = new RegExp(
		`\\n*[ \\t]*${escOpen}[\\s\\S]*?${escClose}[ \\t]*\\n*`,
		'g',
	);
	if (!re.test(body)) return body;
	return body.replace(re, '\n\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Apply a FULLY-ANSWERED sidecar's answers to its item ATOMICALLY, then route it.
 * The keystone APPLY rung the advance engine dispatches into once the classifier
 * said `apply` (all entries answered) AND the `advancing` lock was won.
 *
 * The decision (the human's recorded intent + the caller's routing — NEVER an
 * invention):
 *
 *   1. **append / re-pause** — `appendQuestions` is non-empty: append `qN+1…`,
 *      keep `needsAnswers:true`, re-pause (one commit, body + sidecar).
 *   2. **discharge by deletion** — `discharge` is set (the `delete-source`
 *      verdict): `git rm` the source + sidecar in a standalone revertible commit,
 *      the reason in the commit message.
 *   3. **resolve fully** (the default) — clear `needsAnswers` + delete the sidecar
 *      in ONE commit; the item advances toward build by its normal lifecycle.
 */
export function applyAnsweredQuestions(
	options: ApplyAnsweredQuestionsOptions,
): ApplyAnsweredQuestionsResult {
	const {cwd, item, itemPath: capturedItemPath, env} = options;
	const note = options.note ?? (() => {});

	if (gitSoft(['rev-parse', '--git-dir'], cwd, env).status !== 0) {
		throw new ApplyPersistError('not inside a git repository');
	}

	const {model, path: sidecarPath} = readSidecar(cwd, item);

	// FOLDER-AGNOSTIC at WRITE-TIME (F3a, prd
	// `staging-surface-and-apply-promote-safety`): re-resolve the item's CURRENT
	// path by IDENTITY, mirroring the sidecar's already-folder-agnostic
	// resolution. The captured `itemPath` is ADVISORY — a concurrent `promote`
	// (`tasks/backlog → tasks/ready`, `prds/proposed → prds/ready`) may have
	// moved the item between capture and now, and we MUST write the post-move
	// path, never the stale one. If the item has vanished entirely, exit CLEAN
	// (no commit, no ghost file) — the matching benign skip the surface/triage
	// rungs already use.
	const resolvedItemPath = resolveItemPathByIdentity(cwd, item);
	if (resolvedItemPath === undefined) {
		const message =
			`apply ${item}: item file is gone (captured '${capturedItemPath}' is ` +
			`stale and no current path resolves by identity) — exiting clean (no ` +
			`commit), the apply rung does not recreate a vanished item.`;
		note(message);
		return {
			outcome: 'vanished',
			sidecarPath,
			itemPath: capturedItemPath,
			message,
		};
	}
	const itemPath = resolvedItemPath;

	// NEVER invent an answer: the apply only ever runs on a FULLY-answered sidecar
	// (the classifier NO-OPs a subset). Assert the boundary so a mis-call is loud,
	// not a silent invention of an answer for an unanswered entry.
	if (!allAnswered(model)) {
		throw new ApplyPersistError(
			`refusing to apply ${item}: the sidecar has unanswered entries — a subset ` +
				'is a classifier NO-OP, never an apply (the rung NEVER invents an answer)',
		);
	}

	const itemAbs = join(cwd, itemPath);
	const baseBody = readItem(itemAbs, cwd, itemPath, env);
	const by = options.by || resolveBy(cwd, env);

	// (1) APPEND / RE-PAUSE: the apply has new questions. Append them (`qN+1…`,
	// never mutating an answered entry), stay needsAnswers:true, re-pause. Re-pause
	// WINS over a discharge — you cannot discharge a source you are still asking
	// about.
	const followups = options.appendQuestions ?? [];
	if (followups.length > 0) {
		const repaused = appendQuestions(model, followups);
		const result: ApplyAtomicResult = applyAtomic({
			cwd,
			itemPath,
			itemBody: withAppliedAnswers(baseBody, model.entries),
			sidecar: repaused,
			mode: 'repause',
			by,
			env,
			note,
		});
		const message = `applied ${item} + appended ${followups.length} new question(s) → re-paused (needsAnswers:true).`;
		note(message);
		return {
			outcome: 'repaused',
			commit: result.commit,
			sidecarPath,
			itemPath,
			message,
		};
	}

	// (2) DISCHARGE BY DELETION: the caller decided the source should leave by
	// deletion (the `delete-source` verdict). `git rm` the source + sidecar in a
	// STANDALONE revertible commit, the reason in the commit message (git history =
	// archive). DIRECT — no preview/confirm (decision 12); the human's answer is
	// the source of truth.
	if (options.discharge !== undefined) {
		return dischargeByDeletion({
			cwd,
			item,
			itemPath,
			reason: options.discharge.reason,
			sidecarPath,
			by,
			env,
			note,
		});
	}

	// (3) RESOLVE FULLY (the default): clear needsAnswers + delete the sidecar in
	// ONE commit. Full-resolution reconcile (D1): strip the now-stale marker-fenced
	// open-questions block(s) so the resolved body reads as resolved. Backward
	// compatible — no marker ⇒ identical bytes. The re-pause path above is
	// deliberately untouched (D3): its open-questions block is still open.
	const reconciledBody = stripOpenQuestionsBlocks(baseBody);
	const resolvedBody = withAppliedAnswers(reconciledBody, model.entries);
	const result = applyAtomic({
		cwd,
		itemPath,
		itemBody: resolvedBody,
		sidecar: model,
		mode: 'resolve',
		by,
		env,
		note,
	});
	const message = `applied ${item} → resolved (needsAnswers cleared, sidecar deleted).`;
	note(message);
	return {
		outcome: 'resolved',
		commit: result.commit,
		sidecarPath,
		itemPath,
		message,
	};
}

interface DischargeInput {
	cwd: string;
	item: string;
	itemPath: string;
	/** The human's discharge reason (their answer text), recorded in the commit message. */
	reason: string;
	sidecarPath: string;
	by: string;
	env: NodeJS.ProcessEnv | undefined;
	note: (m: string) => void;
}

/**
 * DISCHARGE a source by DELETION (the `delete-source` verdict, US #5/#11): `git
 * rm` the source AND its answered sidecar in ONE STANDALONE commit, the human's
 * discharge reason recorded in the commit MESSAGE (git history is the archive).
 * There is no spawned artifact for a discharge, so the deletion is a standalone
 * commit (a `mint`, by contrast, rides the new artifact's create commit through
 * `promoteObservation`).
 *
 * A discharged item leaves by being GONE — no resting body marker, no `triaged:`
 * stamp (the resting-state machinery is retired; an item is still-open, acted-on,
 * or deleted). This is the apply rung applying the human's RATIFIED answer (the
 * deletion is human-authored), and it is git-recoverable (a single revertible
 * commit) — a wrong inference is never catastrophic.
 */
function dischargeByDeletion(
	input: DischargeInput,
): ApplyAnsweredQuestionsResult {
	const {cwd, item, itemPath, reason, sidecarPath, by, env, note} = input;
	// `git rm` the source. The sidecar may not exist in every path; rm it too when
	// present, so the discharge leaves no answered-sidecar residue. Both ride ONE
	// commit.
	const rmPaths = [itemPath];
	if (existsSync(join(cwd, sidecarPath))) {
		rmPaths.push(sidecarPath);
	}
	gitHard(['rm', '--quiet', '--', ...rmPaths], cwd, env);
	const reasonLine = reason.trim() === '' ? '(no reason given)' : reason.trim();
	const subject = `advance: ${item} → deleted (by ${by})`;
	const messageBody =
		`Discharged by deletion (the human's ratified answer authors it; ` +
		`git history is the archive).\n\nreason: ${reasonLine}`;
	gitHard(['commit', '--quiet', '-m', subject, '-m', messageBody], cwd, env);
	const commit = gitHard(['rev-parse', 'HEAD'], cwd, env).stdout.trim();
	const message =
		`applied ${item} → deleted (source git rm-ed in a standalone commit; reason ` +
		'in the commit message, git history is the archive).';
	note(message);
	return {
		outcome: 'deleted',
		commit,
		sidecarPath,
		itemPath,
		message,
	};
}

// Re-export the heading constant the tests assert against, so the byte-level
// marker stays in one place.
export {APPLIED_HEADING};
