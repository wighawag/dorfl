/**
 * The MASS-DELETION GUARD: catch a build agent that accidentally gutted a
 * pre-existing file before the work is gated and proposed.
 *
 * Motivating incident: a build agent "rewrote" a ~780-line `CONTEXT.md` and left
 * it with 3 insertions and 313 deletions, ending mid-sentence. The acceptance
 * gate was green (prose is not tested), so the PR opened with half the project's
 * context doc gone; only the human Gate-3 caught it.
 *
 * What it does, between the agent's clean exit and the acceptance gate:
 *
 *   1. {@link detectMassDeletions} diffs the work (committed + uncommitted,
 *      tracked files only) against its merge-base with `<arbiter>/main` and flags
 *      every PRE-EXISTING text file whose NET line loss crosses the threshold
 *      ({@link isMassDeletion}).
 *   2. {@link runWithMassDeletionGuard} feeds the findings back to the agent
 *      ONCE, as a follow-up turn in the SAME session ("you removed N lines from X;
 *      restore it, or confirm the task asked for it").
 *   3. Whatever is STILL flagged after that turn (a confirmed-intentional
 *      deletion, or a failed follow-up) is returned as a Markdown note the caller
 *      appends to the PR body, so the reviewer sees it immediately.
 *
 * The guard is ADVISORY: it never fails, stops or stucks a build by itself. A
 * plumbing failure (no merge-base, git error) reads as "nothing flagged". See ADR
 * `docs/adr/mass-deletion-guard-asks-the-agent-once-then-tells-the-reviewer.md`.
 */
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {run as runProcess} from './git.js';
import {parseStopSentinel} from './agent-stop.js';
import {parseFrontmatter} from './frontmatter.js';

/** The resolved guard knobs (config keys `massDeletionGuard*`). */
export interface MassDeletionGuardConfig {
	/** Run the guard at all (config `massDeletionGuard`, default `true`). */
	enabled: boolean;
	/**
	 * Flag a file that loses MORE than this many lines net, whatever its size
	 * (config `massDeletionLines`, default 150).
	 */
	lines: number;
	/**
	 * Flag a file that loses MORE than this share of its lines net, in `(0, 1]`
	 * (config `massDeletionRatio`, default 0.4). Only applies once the loss is at
	 * least {@link MASS_DELETION_RATIO_FLOOR} lines, so trimming a tiny file never
	 * trips it.
	 */
	ratio: number;
}

/** The built-in guard: on, >150 lines or >40% of the file. */
export const DEFAULT_MASS_DELETION_GUARD: MassDeletionGuardConfig = {
	enabled: true,
	lines: 150,
	ratio: 0.4,
};

/** The guard knobs from a resolved config (`massDeletionGuard*` keys). */
export function massDeletionGuardFromConfig(config: {
	massDeletionGuard: boolean;
	massDeletionLines: number;
	massDeletionRatio: number;
}): MassDeletionGuardConfig {
	return {
		enabled: config.massDeletionGuard,
		lines: config.massDeletionLines,
		ratio: config.massDeletionRatio,
	};
}

/**
 * The guard for ONE task: the resolved repo policy (absent ⇒ the built-in
 * default), with the task's own `massDeletionGuard: true|false` frontmatter
 * overriding `enabled`. A planned refactor opts out in its task file instead of
 * turning the guard off for the whole repo.
 */
export function massDeletionGuardForTask(
	repoResolved: MassDeletionGuardConfig | undefined,
	taskContent: string,
): MassDeletionGuardConfig {
	const base = repoResolved ?? DEFAULT_MASS_DELETION_GUARD;
	const override = parseFrontmatter(taskContent).massDeletionGuard;
	return override === undefined ? base : {...base, enabled: override};
}

/**
 * The minimum NET loss (lines) before the RATIO rule can flag a file: removing 5
 * lines of a 10-line file is 50% but not a mass deletion. Not configurable on
 * purpose: it is noise suppression, not policy.
 */
export const MASS_DELETION_RATIO_FLOOR = 20;

/** One flagged file. */
export interface MassDeletion {
	/** The path in the work tree (the NEW path of a rename). */
	path: string;
	/** Line count of the file at the merge-base (the OLD path of a rename). */
	baseLines: number;
	/** Lines added by the work. */
	added: number;
	/** Lines deleted by the work. */
	deleted: number;
	/** Net lines lost (`deleted - added`). */
	lost: number;
	/** The file no longer exists in the work tree. */
	removed: boolean;
}

/** One parsed `git diff --numstat -z` entry (text files only). */
export interface NumstatEntry {
	path: string;
	/** Set for a rename/copy: the path at the base. */
	oldPath?: string;
	added: number;
	deleted: number;
}

/**
 * Parse `git diff --numstat -z` output. Binary files (`-\t-`) are dropped. With
 * `-z` a plain entry is `A\tD\tpath\0`; a rename is `A\tD\t\0old\0new\0`.
 */
export function parseNumstatZ(out: string): NumstatEntry[] {
	const tokens = out.split('\0');
	const entries: NumstatEntry[] = [];
	let i = 0;
	while (i < tokens.length) {
		const head = tokens[i];
		i++;
		if (head === '') {
			continue;
		}
		const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(head);
		if (m === null) {
			continue;
		}
		let path = m[3];
		let oldPath: string | undefined;
		if (path === '') {
			oldPath = tokens[i] ?? '';
			path = tokens[i + 1] ?? '';
			i += 2;
		}
		if (m[1] === '-' || m[2] === '-') {
			continue; // binary
		}
		entries.push({
			path,
			...(oldPath !== undefined ? {oldPath} : {}),
			added: Number(m[1]),
			deleted: Number(m[2]),
		});
	}
	return entries;
}

/**
 * The threshold rule (pure). A file is a mass deletion when its NET loss is
 * more than `guard.lines`, or more than `guard.ratio` of its base line count and
 * at least {@link MASS_DELETION_RATIO_FLOOR} lines. A file that existed with no
 * lines can never trip it.
 */
export function isMassDeletion(
	stat: {baseLines: number; lost: number},
	guard: MassDeletionGuardConfig,
): boolean {
	const {baseLines, lost} = stat;
	if (lost <= 0 || baseLines <= 0) {
		return false;
	}
	if (lost > guard.lines) {
		return true;
	}
	return lost >= MASS_DELETION_RATIO_FLOOR && lost / baseLines > guard.ratio;
}

/** Count lines the way `git diff` does (a trailing partial line counts). */
function countLines(text: string): number {
	if (text === '') {
		return 0;
	}
	const newlines = text.split('\n').length - 1;
	return text.endsWith('\n') ? newlines : newlines + 1;
}

/**
 * The merge-base of `HEAD` and `<arbiter>/main`: the tree the work started from.
 * Refreshes `<arbiter>/main` first with the same explicit refspec the empty-diff
 * backstop uses (a bare-mirror job worktree has no fetch refspec, so the ref may
 * not exist at all); a failed fetch falls back to whatever ref is there.
 * `undefined` when it cannot be resolved (the guard then flags nothing).
 */
export function resolveGuardBase(params: {
	cwd: string;
	arbiter: string;
	env?: NodeJS.ProcessEnv;
}): string | undefined {
	const {cwd, arbiter, env} = params;
	try {
		runProcess(
			'git',
			[
				'fetch',
				'--quiet',
				arbiter,
				`+refs/heads/main:refs/remotes/${arbiter}/main`,
			],
			cwd,
			{env},
		);
		const res = runProcess(
			'git',
			['merge-base', 'HEAD', `${arbiter}/main`],
			cwd,
			{env},
		);
		const sha = res.stdout.trim();
		return res.status === 0 && sha !== '' ? sha : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Flag every pre-existing tracked text file the work shrank past the threshold.
 * The diff is the merge-base with `<arbiter>/main` against the WORKING TREE, so
 * it covers the branch's commits AND the agent's uncommitted edits. Untracked
 * (brand-new) files cannot be flagged. Best-effort: any git failure ⇒ `[]`.
 */
export function detectMassDeletions(params: {
	cwd: string;
	arbiter: string;
	env?: NodeJS.ProcessEnv;
	guard?: MassDeletionGuardConfig;
	/** Pre-resolved base (else {@link resolveGuardBase}). */
	base?: string;
}): MassDeletion[] {
	const {cwd, env} = params;
	const guard = params.guard ?? DEFAULT_MASS_DELETION_GUARD;
	if (!guard.enabled) {
		return [];
	}
	try {
		const base = params.base ?? resolveGuardBase(params);
		if (base === undefined) {
			return [];
		}
		const diff = runProcess(
			'git',
			['diff', '--numstat', '-z', '-M', base, '--'],
			cwd,
			{env},
		);
		if (diff.status !== 0) {
			return [];
		}
		const flagged: MassDeletion[] = [];
		for (const entry of parseNumstatZ(diff.stdout)) {
			const lost = entry.deleted - entry.added;
			// Cheap pre-filter: the ratio rule needs at least the floor.
			if (lost < Math.min(MASS_DELETION_RATIO_FLOOR, guard.lines + 1)) {
				continue;
			}
			const blob = runProcess(
				'git',
				['cat-file', '-p', `${base}:${entry.oldPath ?? entry.path}`],
				cwd,
				{env},
			);
			if (blob.status !== 0) {
				continue; // not in the base: not pre-existing
			}
			const baseLines = countLines(blob.stdout);
			if (!isMassDeletion({baseLines, lost}, guard)) {
				continue;
			}
			flagged.push({
				path: entry.path,
				baseLines,
				added: entry.added,
				deleted: entry.deleted,
				lost,
				removed: !existsSync(join(cwd, entry.path)),
			});
		}
		return flagged;
	} catch {
		return [];
	}
}

/** One human line per flagged file (shared by the prompt and the PR note). */
export function describeMassDeletion(d: MassDeletion): string {
	if (d.removed) {
		return `\`${d.path}\`: file deleted (it had ${d.baseLines} lines)`;
	}
	return (
		`\`${d.path}\`: ${d.lost} of its ${d.baseLines} lines removed ` +
		`(+${d.added} -${d.deleted})`
	);
}

/**
 * The ONE follow-up turn the agent gets when the guard trips. Self-contained
 * (the null/shell adapter starts a fresh process; pi resumes the build session).
 */
export function massDeletionFollowUpPrompt(params: {
	slug: string;
	base: string;
	flagged: readonly MassDeletion[];
}): string {
	const {slug, base, flagged} = params;
	return [
		`Before your build of '${slug}' goes to the acceptance gate, the runner ` +
			`compared your changes with the commit the work started from ` +
			`(${base}) and found large deletions in files that already existed:`,
		'',
		...flagged.map((d) => `- ${describeMassDeletion(d)}`),
		'',
		'This can be a file that was rewritten whole and came out truncated, or ' +
			'it can be exactly what the task wanted. For EACH file above:',
		'- If the removal is part of what this task asked for, including content ' +
			'you deliberately MOVED elsewhere (a file split, an extraction, a ' +
			'relocation, a retired file), it is intended: do NOT restore it. Leave ' +
			'it as it is and say in one line where the content went or why it was ' +
			'removed.',
		'- Only if the content was lost by accident, restore it ' +
			`(\`git show ${base}:<path>\` prints the original) and redo your ` +
			'change as a targeted edit.',
		'When unsure, check whether the removed content now exists somewhere ' +
			'else in your change before restoring anything: restoring moved code ' +
			'duplicates it.',
		'',
		'Change nothing else and do no git commits. End with one line per file ' +
			'saying what you did.',
	].join('\n');
}

/** Heading of the PR-body section (so a reviewer and a test can find it). */
export const MASS_DELETION_NOTE_HEADING = '## Large deletions (runner check)';

/**
 * The PR-body section for what is STILL flagged once the follow-up turn is
 * over. `followUp` says how that turn went, so the reviewer knows whether the
 * agent was asked.
 */
export function massDeletionReviewNote(params: {
	flagged: readonly MassDeletion[];
	followUp: 'confirmed' | 'failed';
}): string {
	const {flagged, followUp} = params;
	const lead =
		followUp === 'confirmed'
			? 'The runner asked the build agent to restore or confirm these large ' +
				'deletions; they are still in the change, so the agent kept them as ' +
				'intended. Check that the task really asked for them:'
			: 'The runner flagged these large deletions, but its follow-up turn ' +
				'asking the build agent to restore or confirm them failed. Check ' +
				'them before merging:';
	return [
		MASS_DELETION_NOTE_HEADING,
		'',
		lead,
		'',
		...flagged.map((d) => `- ${describeMassDeletion(d)}`),
	].join('\n');
}

/**
 * Append the guard's PR-body note (if any) to the agent's summary. Both absent ⇒
 * `undefined` (the provider keeps its `--fill` fallback).
 */
export function withMassDeletionNote(
	body: string | undefined,
	note: string | undefined,
): string | undefined {
	if (note === undefined) {
		return body;
	}
	return body === undefined || body.trim() === ''
		? note
		: `${body.trimEnd()}\n\n${note}`;
}

/** The fields of an agent launch result the guard reads. */
export interface GuardableAgentResult {
	ok: boolean;
	output?: string;
	timedOut?: boolean;
	cutOffTurn?: unknown;
	record?: {session?: string};
}

/**
 * Run the agent, then (on a clean finish that changed files) the guard: flag,
 * ask ONCE, re-check, and report what remains.
 *
 * `launch(prompt, session)` runs one agent turn; the follow-up passes the first
 * turn's recorded session file so pi resumes the SAME conversation.
 *
 * Returns the result the caller should route, plus `massDeletionNote` for the PR
 * body when something is still flagged. The FIRST turn's `output` is kept (it
 * is the build summary the PR body and the STOP sentinel are read from). A
 * follow-up that TIMED OUT returns that turn's deadline fields so the caller's
 * checkpoint route runs; a follow-up that otherwise failed is ignored (the first
 * result stands) and reported in the note. The guard is skipped on a failed,
 * timed-out or cut-off first turn and on an explicit TASK-STOP.
 */
export async function runWithMassDeletionGuard<
	R extends GuardableAgentResult,
>(params: {
	launch: (prompt: string, session?: string) => R | Promise<R>;
	prompt: string;
	slug: string;
	cwd: string;
	arbiter: string;
	env?: NodeJS.ProcessEnv;
	guard?: MassDeletionGuardConfig;
	note?: (message: string) => void;
}): Promise<R & {massDeletionNote?: string}> {
	const guard = params.guard ?? DEFAULT_MASS_DELETION_GUARD;
	const note = params.note ?? (() => {});
	const first = await params.launch(params.prompt);
	if (
		!guard.enabled ||
		!first.ok ||
		first.timedOut === true ||
		first.cutOffTurn !== undefined ||
		parseStopSentinel(first.output) !== undefined
	) {
		return first;
	}
	const base = resolveGuardBase(params);
	if (base === undefined) {
		return first;
	}
	const flagged = detectMassDeletions({...params, guard, base});
	if (flagged.length === 0) {
		return first;
	}
	note(
		`Mass-deletion guard: '${params.slug}' removed large parts of ` +
			`${flagged.length} pre-existing file(s) (${flagged
				.map((d) => d.path)
				.join(', ')}); asking the agent once to restore or confirm.`,
	);

	let followUpOk = false;
	try {
		const second = await params.launch(
			massDeletionFollowUpPrompt({slug: params.slug, base, flagged}),
			first.record?.session,
		);
		if (second.timedOut === true) {
			// The deadline fired during the follow-up: let the caller checkpoint.
			return {...second, output: first.output};
		}
		followUpOk = second.ok;
		if (!second.ok) {
			note(
				`Mass-deletion guard: the follow-up turn for '${params.slug}' failed; ` +
					'continuing with the first build and flagging the deletions.',
			);
		}
	} catch (err) {
		note(
			`Mass-deletion guard: the follow-up turn for '${params.slug}' threw ` +
				`(${err instanceof Error ? err.message : String(err)}); continuing.`,
		);
	}

	const remaining = detectMassDeletions({...params, guard, base});
	if (remaining.length === 0) {
		note(`Mass-deletion guard: '${params.slug}' restored the flagged files.`);
		return first;
	}
	note(
		`Mass-deletion guard: still flagged after the follow-up: ${remaining
			.map((d) => d.path)
			.join(', ')} (recorded in the PR body).`,
	);
	return {
		...first,
		massDeletionNote: massDeletionReviewNote({
			flagged: remaining,
			followUp: followUpOk ? 'confirmed' : 'failed',
		}),
	};
}
