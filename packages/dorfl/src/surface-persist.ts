import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {run, type RunResult} from './git.js';
import {parseFrontmatter, setNeedsAnswersMarker} from './frontmatter.js';
import {
	appendQuestions,
	newSidecar,
	parseSidecar,
	serialiseSidecar,
	sidecarPathFor,
	type NewQuestion,
	type SidecarModel,
} from './sidecar.js';

/**
 * The engine-owned SURFACE PERSIST (spec `advance-loop`, task
 * `advance-rung-surface`, US #15/33) — the half of the surface rung the ENGINE
 * owns (the skill JUDGES, the engine PERSISTS). Given the questions the
 * `surface-questions` skill EMITTED (gathered by `surface-gate.ts`'s spawn), the
 * engine writes them to the sidecar `work/questions/<type>-<slug>.md` and sets
 * `needsAnswers:true` on the item body — in ONE commit, exactly as the review
 * gate persists a verdict and `applyAtomic` resolves an answer batch in one
 * commit.
 *
 * It is the SIBLING of {@link import('./sidecar-apply.js').applyAtomic}: that is
 * the APPLY rung's one-commit primitive (resolve/re-pause); this is the SURFACE
 * rung's one-commit primitive (append-or-create + set `needsAnswers`). Kept in a
 * SEPARATE module so the surface rung's persist and the apply rung's persist stay
 * file-orthogonal (the rung bodies land in different tasks).
 *
 * The load-bearing rules (the task's acceptance criteria):
 *
 *   - **Append-never-overwrite (US #15).** When a sidecar ALREADY exists, the new
 *     questions are APPENDED ({@link appendQuestions} mints `qN+1…`), NEVER
 *     overwriting an existing (answered or unanswered) entry. A re-surface that
 *     adds questions to a previously-all-answered sidecar FLIPS it back to
 *     not-all-answered (the appended entries are pending).
 *   - **Set `needsAnswers:true` atomically (invariant 1).** The item body's
 *     `needsAnswers` flag is set to `true` in the SAME commit the sidecar is
 *     written, so the `needsAnswers:true ⟺ active sidecar` invariant holds the
 *     instant the commit lands.
 *   - **Identity-keyed sidecar path.** The sidecar path derives PURELY from the
 *     item's namespaced identity ({@link sidecarPathFor}) — it survives the item's
 *     `git mv`s with no lock-step move.
 *
 * This is the LOCAL one-commit primitive over a working tree (the
 * throwaway-git-repo test pattern the apply/lock tests use). The `advancing` CAS
 * lock that makes this WINNER-ONLY is held by `performAdvance` BEFORE this is
 * called — so the expensive spawn + this persist are both POST-lock. This module
 * does NOT race the arbiter; that is the lock's job.
 */

export interface SurfacePersistOptions {
	/** Working clone/worktree the persist commits in. */
	cwd: string;
	/** The namespaced item identity (`task:foo` / `prd:bar` / `observation:baz`). */
	item: string;
	/**
	 * The item file path RELATIVE to `cwd` (e.g. `work/backlog/foo.md`). The
	 * `needsAnswers:true` flag is set on THIS file; the sidecar path is derived
	 * from the identity, NOT from this path.
	 */
	itemPath: string;
	/** The questions the `surface-questions` skill emitted (engine appends them). */
	questions: NewQuestion[];
	/** Advisory committer id for the commit subject. Defaults to git user.name. */
	by?: string;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface SurfacePersistResult {
	/** `surfaced` (questions written + needsAnswers set) or `nothing` (empty emit). */
	outcome: 'surfaced' | 'nothing';
	/** The commit sha the persist produced (`undefined` on a `nothing` no-op). */
	commit?: string;
	/** The sidecar path (relative to `cwd`) the persist touched. */
	sidecarPath: string;
	/** How many entries the sidecar carries after this persist. */
	entryCount: number;
}

/** Raised for usage errors (a missing repo, an unreadable item). */
export class SurfacePersistError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SurfacePersistError';
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
		throw new SurfacePersistError(
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

/**
 * Persist the SURFACED questions ATOMICALLY: APPEND them to the existing sidecar
 * (or CREATE it first-pass), and set `needsAnswers:true` on the item body — ONE
 * commit. An EMPTY question set is a clean NO-OP (no sidecar written, the item
 * untouched): the honest "no open judgement" result the skill is allowed to
 * emit; nothing to commit, so `needsAnswers` is NOT set.
 *
 * Append-never-overwrite: when a sidecar exists, the new questions are APPENDED
 * (never mutating an answered entry); a re-surface flips a previously-all-answered
 * sidecar back to not-all-answered. Returns the produced commit + the resulting
 * entry count.
 */
export function persistSurfacedQuestions(
	options: SurfacePersistOptions,
): SurfacePersistResult {
	const {cwd, item, itemPath, questions, env} = options;
	const note = options.note ?? (() => {});

	if (gitSoft(['rev-parse', '--git-dir'], cwd, env).status !== 0) {
		throw new SurfacePersistError('not inside a git repository');
	}

	const sidecarPath = sidecarPathFor(item);
	const sidecarAbs = join(cwd, sidecarPath);

	// Build the post-persist sidecar model: APPEND to an existing one (never
	// overwrite), else CREATE first-pass. Read the current sidecar from the tree
	// so the append is over the COMMITTED history (identity-keyed, folder-agnostic).
	let model: SidecarModel;
	const existing = readExistingSidecar(sidecarAbs);
	if (existing !== undefined) {
		model = appendQuestions(existing, questions);
	} else {
		model = newSidecar(item, questions);
	}

	// An empty emit ⇒ the sidecar would carry no entries: surface NOTHING (the
	// honest result). Do NOT write a sidecar or set `needsAnswers` — a sidecar with
	// no open questions should not exist (it keeps invariant 1 + the "pending ⇒
	// NO-OP" classifier honest).
	if (model.entries.length === 0) {
		const message = `surface ${item}: no open judgement — nothing surfaced (no sidecar written).`;
		note(message);
		return {outcome: 'nothing', sidecarPath, entryCount: 0};
	}

	// Set `needsAnswers:true` on the item body (the only in-body signal — the
	// sidecar path is identity-derived, no back-pointer). The item file may not
	// have a `needsAnswers` line yet (and may be fence-less — observations are born
	// that way); `setNeedsAnswersMarker` prepends a fence when needed and is
	// idempotent otherwise.
	const itemAbs = join(cwd, itemPath);
	const itemBody = readItem(itemAbs, cwd, itemPath, env);
	const flagged = setNeedsAnswersMarker(itemBody, true);

	// DEFENSE IN DEPTH (the `sidecar-without-needsAnswers` guard): the surface
	// commit is only atomic if the flag ACTUALLY landed. If — for any reason — the
	// flag did not parse back as `true` (e.g. a degenerate body the marker writer
	// cannot annotate), ABORT BEFORE writing the sidecar, so we never produce the
	// torn invariant (sidecar present, flag absent) a later tick refuses to advance.
	if (parseFrontmatter(flagged).needsAnswers !== true) {
		throw new SurfacePersistError(
			`surface ${item}: could not set needsAnswers:true on '${itemPath}' ` +
				`(the item body could not be annotated) — refusing to write the sidecar ` +
				`without the flag (that would tear the needsAnswers ⟺ sidecar invariant).`,
		);
	}
	writeFileSync(itemAbs, flagged);

	// Write the appended/created sidecar.
	mkdirSync(dirname(sidecarAbs), {recursive: true});
	writeFileSync(sidecarAbs, serialiseSidecar(model));

	// Stage exactly the two paths and commit them TOGETHER (one atomic commit) —
	// the sidecar write + the `needsAnswers:true` flip land in the SAME commit, so
	// `needsAnswers:true ⟺ active sidecar` holds the instant it lands.
	const by = options.by || resolveBy(cwd, env);
	gitHard(['add', '--', itemPath, sidecarPath], cwd, env);
	const subject = `advance: surface ${item} (${model.entries.length} question(s), by ${by})`;
	gitHard(['commit', '--quiet', '-m', subject], cwd, env);
	const commit = gitHard(['rev-parse', 'HEAD'], cwd, env).stdout.trim();
	note(subject);

	return {
		outcome: 'surfaced',
		commit,
		sidecarPath,
		entryCount: model.entries.length,
	};
}

/** Read + parse the existing sidecar (from the tree, then the working file). */
function readExistingSidecar(sidecarAbs: string): SidecarModel | undefined {
	if (!existsSync(sidecarAbs)) {
		return undefined;
	}
	return parseSidecar(readFileSync(sidecarAbs, 'utf8'));
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
		throw new SurfacePersistError(
			`cannot read item body for '${itemPath}' (the surface rung needs the item file)`,
		);
	}
}
