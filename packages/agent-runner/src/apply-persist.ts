import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {workFolderPath, workFolderPrefix, workItemRel} from './work-layout.js';
import {run, type RunResult} from './git.js';
import {setFrontmatterMarker} from './frontmatter.js';
import {applyAtomic, type ApplyAtomicResult} from './sidecar-apply.js';
import {
	allAnswered,
	appendQuestions,
	isEntryAnswered,
	parseSidecar,
	sidecarPathFor,
	type NewQuestion,
	type SidecarDisposition,
	type SidecarEntry,
	type SidecarModel,
} from './sidecar.js';

/**
 * The engine-owned APPLY PERSIST (PRD `advance-loop`, slice `advance-rung-apply`,
 * US #11/14/15/29/30) — the half of the APPLY rung the ENGINE owns. On
 * `classify=apply` (ALL sidecar entries answered), it applies the HUMAN's
 * answers to the item ATOMICALLY (item body + sidecar in ONE commit, via the
 * sidecar contract's {@link applyAtomic}), then EITHER:
 *
 *   - **append / re-pause** — when the apply discovers/appends NEW questions:
 *     append `qN+1…`, stay `needsAnswers:true`, re-pause (the "all answered?"
 *     flips back to false); OR
 *   - **resolve fully** — clear `needsAnswers` + DELETE the sidecar in the SAME
 *     atomic commit (the invariant `needsAnswers:false ⟺ no active sidecar`); OR
 *   - **disposition to a terminal** — an answered entry's `disposition` routes the
 *     item to a terminal state (advance / dropped / needs-attention /
 *     observation keep / delete). The apply rung EXECUTES the recorded routing.
 *
 * It is the SIBLING of {@link import('./surface-persist.js').persistSurfacedQuestions}:
 * that is the SURFACE rung's one-commit primitive (append-or-create + set
 * `needsAnswers`); this is the APPLY rung's (apply answers + resolve/re-pause/
 * disposition). Kept file-orthogonal so the rung bodies land in different slices.
 *
 * **NEVER invents an answer (US #4).** The apply rung applies ONLY what the human
 * authored — the recorded `answer:` text and the `disposition:` field. It does
 * NOT fill, guess, or author an answer; a SUBSET-answered sidecar is not even
 * classified `apply` (the classifier NO-OPs), so this is only ever called with a
 * fully-answered sidecar. **ALWAYS allowed (no gate)** — applying a human's
 * answer is never gated, even with every autonomy flag off (the engine, not this
 * module, enforces the no-gate sequencing).
 *
 * Like the surface persist, this is the LOCAL one-commit primitive over a working
 * tree (the throwaway-git-repo test pattern). The `advancing` CAS lock that makes
 * it WINNER-ONLY is held by `performAdvance` BEFORE this is called; this module
 * does NOT race the arbiter — that is the lock's job.
 */

/** Marker that opens the applied-answers record in an item body. */
const APPLIED_HEADING = '## Applied answers';

/** The frontmatter marker a "keep" disposition stamps (US #30). */
const TRIAGED_KEEP = 'keep';

export interface ApplyAnsweredQuestionsOptions {
	/** Working clone/worktree the apply commits in. */
	cwd: string;
	/** The namespaced item identity (`slice:foo` / `prd:bar` / `observation:baz`). */
	item: string;
	/**
	 * The item file path RELATIVE to `cwd` (e.g. `work/backlog/foo.md`). The
	 * sidecar path is derived from the identity, NOT from this path (identity-keyed,
	 * folder-agnostic). The apply rewrites THIS file + the sidecar and commits them
	 * together.
	 */
	itemPath: string;
	/**
	 * NEW follow-up questions the apply discovered (the human's answer raised more
	 * judgement). When non-empty, the apply APPENDS them (`qN+1…`, never mutating an
	 * answered entry) and RE-PAUSES (`needsAnswers:true` stays) — the "all answered?"
	 * flips back to false. Empty/omitted ⇒ resolve (or disposition) the item.
	 */
	appendQuestions?: NewQuestion[];
	/** Advisory committer id for the commit subject. Defaults to git user.name. */
	by?: string;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

/** The terminal an apply routed the item to (none ⇒ a plain resolve/re-pause). */
export type ApplyTerminal =
	/** Resolved fully: needsAnswers cleared + sidecar deleted (the default). */
	| 'resolved'
	/** New questions appended; stayed needsAnswers:true and re-paused. */
	| 'repaused'
	/** A "keep" answer stamped `triaged:keep`; the item drops out of the pool. */
	| 'kept'
	/**
	 * Moved to `work/dropped/` (the generic durable "won't-proceed" record —
	 * slice `generic-terminal-dropped-folder-generalising-out-of-scope`, PRD
	 * `staging-pool-position-gate-and-trust-model` US #16/17/18). GENERALISES the
	 * previous `out-of-scope` terminal; the specific REASON (`out-of-scope` /
	 * `superseded by <x>` / `duplicate` / `abandoned`) lives in the item BODY,
	 * not in the folder name.
	 */
	| 'dropped'
	/** Moved to `work/needs-attention/` (the existing bounce — a human must look). */
	| 'needs-attention'
	/** A "delete" answer RECOMMENDED deletion (the human deletes — never auto-delete). */
	| 'delete-recommended';

export interface ApplyAnsweredQuestionsResult {
	/** The terminal the apply reached. */
	outcome: ApplyTerminal;
	/** The commit sha the apply produced. */
	commit?: string;
	/** The sidecar path (relative to `cwd`) the apply touched. */
	sidecarPath: string;
	/** The item path (relative to `cwd`) after the apply (a terminal move changes it). */
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
 * Order on the terminal dispositions, most-decisive first. When the human spread
 * dispositions across entries, the apply executes the SINGLE most-decisive
 * terminal (a needs-attention bounce wins over a dropped, which wins over a
 * keep / delete / plain resolve), so an item never lands in two terminals.
 */
const TERMINAL_PRECEDENCE: SidecarDisposition[] = [
	'needs-attention',
	'dropped',
	'delete',
	'keep',
];

/**
 * Pick the SINGLE terminal disposition to execute from the answered entries (the
 * most-decisive present), or `undefined` for a plain resolve. `promote-slice` /
 * `promote-adr` are NOT terminals HERE — they are the triage rung's new-item
 * creation (slice `advance-rung-triage` consumes the CAS-create helper); the apply
 * rung treats a promote as a plain resolve of THIS item (the promotion is a
 * separate new-item creation, not a move of this one).
 */
function pickTerminal(entries: SidecarEntry[]): SidecarDisposition | undefined {
	const present = new Set<SidecarDisposition>();
	for (const entry of entries) {
		if (entry.disposition !== undefined && isEntryAnswered(entry)) {
			present.add(entry.disposition);
		}
	}
	for (const disposition of TERMINAL_PRECEDENCE) {
		if (present.has(disposition)) {
			return disposition;
		}
	}
	return undefined;
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
		if (entry.disposition !== undefined) {
			lines.push('');
			lines.push(`disposition: ${entry.disposition}`);
		}
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
 * Apply a FULLY-ANSWERED sidecar's answers to its item ATOMICALLY, then route to
 * the right terminal. The keystone APPLY rung the advance engine dispatches into
 * once the classifier said `apply` (all entries answered) AND the `advancing`
 * lock was won.
 *
 * The decision (derived from the answered entries + the optional follow-up
 * questions — the human's recorded intent is the SOLE source of truth, never an
 * invention):
 *
 *   1. **append / re-pause** — `appendQuestions` is non-empty: append `qN+1…`,
 *      keep `needsAnswers:true`, re-pause (one commit, body + sidecar).
 *   2. **terminal disposition** — an answered entry carries a terminal
 *      `disposition` (`needs-attention` / `dropped` / `delete` / `keep`):
 *      resolve the item's Q&A (clear `needsAnswers` + delete the sidecar) AND
 *      execute the routing (a `git mv` to the terminal folder, a `triaged:keep`
 *      marker, or a delete recommendation) — all in ONE commit.
 *   3. **resolve fully** (the default) — clear `needsAnswers` + delete the sidecar
 *      in ONE commit; the item advances toward build by its normal lifecycle.
 */
export function applyAnsweredQuestions(
	options: ApplyAnsweredQuestionsOptions,
): ApplyAnsweredQuestionsResult {
	const {cwd, item, itemPath, env} = options;
	const note = options.note ?? (() => {});

	if (gitSoft(['rev-parse', '--git-dir'], cwd, env).status !== 0) {
		throw new ApplyPersistError('not inside a git repository');
	}

	const {model, path: sidecarPath} = readSidecar(cwd, item);

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

	// (1) APPEND / RE-PAUSE: the apply discovered new questions. Append them
	// (`qN+1…`, never mutating an answered entry), stay needsAnswers:true, re-pause.
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

	// No follow-ups → the Q&A is RESOLVED (clear needsAnswers + delete the sidecar).
	// A terminal disposition routes the (now-resolved) item further.
	const terminal = pickTerminal(model.entries);
	const resolvedBody = withAppliedAnswers(baseBody, model.entries);

	if (terminal === 'keep') {
		return resolveWithKeepMarker({
			cwd,
			item,
			itemPath,
			body: resolvedBody,
			sidecar: model,
			sidecarPath,
			by,
			env,
			note,
		});
	}

	// The plain resolve (default, and the body half of every terminal route): clear
	// needsAnswers + delete the sidecar in ONE commit. A `delete` disposition adds
	// the recommendation to the body; the human deletes the file (never auto-delete).
	const finalBody =
		terminal === 'delete'
			? appendDeleteRecommendation(resolvedBody)
			: resolvedBody;
	const result = applyAtomic({
		cwd,
		itemPath,
		itemBody: finalBody,
		sidecar: model,
		mode: 'resolve',
		by,
		env,
		note,
	});

	if (terminal === 'dropped' || terminal === 'needs-attention') {
		return moveResolvedItemToTerminal({
			cwd,
			item,
			itemPath,
			terminal,
			by,
			env,
			note,
			sidecarPath,
		});
	}

	const outcome: ApplyTerminal =
		terminal === 'delete' ? 'delete-recommended' : 'resolved';
	const message =
		terminal === 'delete'
			? `applied ${item} → resolved + RECOMMENDED deletion (a human deletes the file; the agent never auto-deletes a signal).`
			: `applied ${item} → resolved (needsAnswers cleared, sidecar deleted).`;
	note(message);
	return {
		outcome,
		commit: result.commit,
		sidecarPath,
		itemPath,
		message,
	};
}

interface KeepInput {
	cwd: string;
	item: string;
	itemPath: string;
	body: string;
	sidecar: SidecarModel;
	sidecarPath: string;
	by: string;
	env: NodeJS.ProcessEnv | undefined;
	note: (m: string) => void;
}

/**
 * A "keep" answer (US #30): stamp `triaged:keep` on the item body, then resolve
 * the Q&A (clear needsAnswers + delete the sidecar) — all in ONE commit. The
 * `triaged:keep` marker drops the item out of the candidate pool so it is never
 * re-asked (the apply executes the recorded disposition; the keep/delete ROUTING
 * is shared with the triage rung, finalised here).
 */
function resolveWithKeepMarker(input: KeepInput): ApplyAnsweredQuestionsResult {
	const {cwd, item, itemPath, body, sidecar, sidecarPath, by, env, note} =
		input;
	const marked = setFrontmatterMarker(body, 'triaged', TRIAGED_KEEP);
	const result = applyAtomic({
		cwd,
		itemPath,
		itemBody: marked,
		sidecar,
		mode: 'resolve',
		by,
		env,
		note,
	});
	const message = `applied ${item} → "keep" (triaged:keep stamped; drops out of the pool, never re-asked).`;
	note(message);
	return {
		outcome: 'kept',
		commit: result.commit,
		sidecarPath,
		itemPath,
		message,
	};
}

interface MoveTerminalInput {
	cwd: string;
	item: string;
	itemPath: string;
	terminal: 'dropped' | 'needs-attention';
	by: string;
	env: NodeJS.ProcessEnv | undefined;
	note: (m: string) => void;
	sidecarPath: string;
}

/**
 * Route the (already Q&A-resolved) item to a terminal LIFECYCLE folder
 * (`dropped/` or `needs-attention/`) via a `git mv` + commit — the SECOND
 * commit of the disposition (the first cleared needsAnswers + deleted the
 * sidecar). Status = the folder (WORK-CONTRACT rule 3): the move IS the terminal
 * state, no frontmatter status field. Returns the NEW item path.
 */
function moveResolvedItemToTerminal(
	input: MoveTerminalInput,
): ApplyAnsweredQuestionsResult {
	const {cwd, item, itemPath, terminal, env, note, sidecarPath} = input;
	const destDir = workFolderPath(cwd, terminal);
	mkdirSync(destDir, {recursive: true});
	const slug = itemPath.replace(/^.*\//, '');
	const destRel = workItemRel(terminal, slug);
	gitHard(['mv', itemPath, destRel], cwd, env);
	gitHard(['add', '-A'], cwd, env);
	const subject = `advance: ${item} → ${terminal} (by ${input.by})`;
	gitHard(['commit', '--quiet', '-m', subject], cwd, env);
	const commit = gitHard(['rev-parse', 'HEAD'], cwd, env).stdout.trim();
	const message = `applied ${item} → ${terminal} (moved to ${workFolderPrefix(
		terminal,
	)}).`;
	note(message);
	return {
		outcome: terminal,
		commit,
		sidecarPath,
		itemPath: destRel,
		message,
	};
}

/** Marker heading for a delete recommendation appended to an item body. */
const DELETE_HEADING = '## Recommended: delete';

/**
 * Append a delete RECOMMENDATION to an item body (the human deletes the file —
 * the agent NEVER auto-deletes a non-duplicate signal, per the capture-bucket
 * contract). Prose only; the recommendation is durable, the deletion is the
 * human's.
 */
function appendDeleteRecommendation(body: string): string {
	const base = body.replace(/\s*$/, '');
	return [
		base,
		'',
		DELETE_HEADING,
		'',
		'A human answered "delete": this item can be removed (git history is the ' +
			'archive). The agent leaves the deletion to the human per the ' +
			'capture-bucket contract.',
		'',
	].join('\n');
}

// Re-export the heading constants the tests assert against, so the byte-level
// markers stay in one place.
export {APPLIED_HEADING, DELETE_HEADING};

/** True when the item carries a `triaged: keep` frontmatter marker. */
export function isTriagedKeep(itemBody: string): boolean {
	const normalized = itemBody.replace(/\r\n/g, '\n');
	if (!normalized.startsWith('---\n')) {
		return false;
	}
	const lines = normalized.split('\n');
	const closing = lines.indexOf('---', 1);
	if (closing === -1) {
		return false;
	}
	for (let i = 1; i < closing; i++) {
		const m = /^triaged\s*:\s*(.*)$/.exec(lines[i]);
		if (m) {
			return m[1].trim() === TRIAGED_KEEP;
		}
	}
	return false;
}
