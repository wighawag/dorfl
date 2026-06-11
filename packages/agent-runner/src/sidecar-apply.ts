import {mkdirSync, writeFileSync, rmSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {run, type RunResult} from './git.js';
import {setNeedsAnswersMarker} from './frontmatter.js';
import {
	allAnswered,
	serialiseSidecar,
	sidecarPathFor,
	type SidecarModel,
} from './sidecar.js';

/**
 * The ATOMIC APPLY — the keystone the advance state-machine invariant
 * `needsAnswers:false ⟺ no active sidecar` rests on. It mutates the item BODY
 * and the SIDECAR in ONE commit, so the human never sees a torn "answer applied
 * but sidecar still open" (a re-ask) or its reverse.
 *
 * Two shapes, both ONE commit:
 *
 *   - **append / re-pause** (the sidecar is NOT fully answered after this apply):
 *     write the updated item body (if any) and the updated sidecar, leaving
 *     `needsAnswers: true`. The sidecar stays present (still carries pending
 *     questions).
 *   - **full resolution** (every entry answered): write the updated item body,
 *     CLEAR `needsAnswers` (→ `false`) on the item, and DELETE the sidecar — all
 *     in the SAME commit. After this the invariant holds: `needsAnswers:false`
 *     and no sidecar file.
 *
 * This slice delivers the single-commit primitive over a working tree (the
 * throwaway-git-repo pattern the slicing-lock / claim-cas tests use). It does
 * NOT take the `advancing` CAS lock or race the arbiter — that is the lock
 * slice's job; this is the contract the lock later wraps. The caller supplies
 * the item's CURRENT body and its on-disk PATH (relative to the repo root); the
 * apply rewrites that file + the sidecar and commits them together.
 */

/** Whether to leave the sidecar present (re-pause) or delete it (resolved). */
export type ApplyMode = 'repause' | 'resolve';

export interface ApplyAtomicOptions {
	/** Working clone/worktree the apply commits in. */
	cwd: string;
	/**
	 * Item path RELATIVE to `cwd` (e.g. `work/backlog/foo.md`). The sidecar path
	 * is derived from the model's identity — NOT from this path — so it survives
	 * the item's `git mv`s (identity-keyed, never folder-keyed).
	 */
	itemPath: string;
	/**
	 * The NEW item body to write (the apply rung's mutation of the item). When
	 * omitted the item body is left as-is on disk (only `needsAnswers` is touched,
	 * and only on full resolution).
	 */
	itemBody?: string;
	/** The sidecar model after this apply (entries updated/appended). */
	sidecar: SidecarModel;
	/**
	 * Override the resolution decision. By default it is DERIVED from the model
	 * (`allAnswered(sidecar)` ⇒ resolve, else re-pause) — the source of truth. An
	 * explicit `mode` is for the caller that already classified; it must agree
	 * with the derived state or the apply throws (no torn invariant).
	 */
	mode?: ApplyMode;
	/** Advisory committer id for the commit subject. Defaults to git user.name. */
	by?: string;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface ApplyAtomicResult {
	/** `resolved` (sidecar deleted, needsAnswers cleared) or `repaused` (still open). */
	outcome: 'resolved' | 'repaused';
	/** The commit sha the apply produced. */
	commit: string;
	/** The sidecar path (relative to `cwd`) the apply touched. */
	sidecarPath: string;
}

/** Raised for usage errors (a torn mode, a missing repo). */
export class ApplyAtomicError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ApplyAtomicError';
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
		throw new ApplyAtomicError(
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
 * Apply an answer batch ATOMICALLY: rewrite the item body + the sidecar in ONE
 * commit, and on full resolution clear `needsAnswers` AND delete the sidecar in
 * that SAME commit. Returns the produced commit + the outcome.
 *
 * The resolution decision is DERIVED from the model (`allAnswered` ⇒ resolve) —
 * the entries are the source of truth, never the frontmatter mirror. A supplied
 * {@link ApplyAtomicOptions.mode} must AGREE with that derived state, else the
 * apply throws (it refuses to publish a torn invariant: a `resolve` that leaves
 * pending entries, or a `repause` that leaves none).
 */
export function applyAtomic(options: ApplyAtomicOptions): ApplyAtomicResult {
	const {cwd, itemPath, itemBody, sidecar, env} = options;
	const note = options.note ?? (() => {});

	if (gitSoft(['rev-parse', '--git-dir'], cwd, env).status !== 0) {
		throw new ApplyAtomicError('not inside a git repository');
	}

	const resolved = allAnswered(sidecar);
	if (options.mode === 'resolve' && !resolved) {
		throw new ApplyAtomicError(
			'applyAtomic mode=resolve but the sidecar still has pending entries — ' +
				'refusing to clear needsAnswers + delete the sidecar with open questions',
		);
	}
	if (options.mode === 'repause' && resolved) {
		throw new ApplyAtomicError(
			'applyAtomic mode=repause but every sidecar entry is answered — ' +
				'a fully-answered sidecar must resolve (clear needsAnswers + delete)',
		);
	}

	const sidecarPath = sidecarPathFor(sidecar.item);
	const itemAbs = join(cwd, itemPath);
	const sidecarAbs = join(cwd, sidecarPath);
	const by = options.by || resolveBy(cwd, env);

	const touched: string[] = [itemPath];

	if (resolved) {
		// Full resolution: write the (optionally-updated) body with needsAnswers
		// CLEARED, and DELETE the sidecar — one commit, the invariant holds after.
		const baseBody = itemBody ?? readItem(itemAbs, cwd, itemPath, env);
		const cleared = setNeedsAnswersMarker(baseBody, false);
		writeFileSync(itemAbs, cleared);
		// Remove the sidecar file from the tree (it may already be absent on a
		// no-sidecar resolve, in which case rm is a no-op for the index).
		rmSync(sidecarAbs, {force: true});
		touched.push(sidecarPath);
	} else {
		// Re-pause: write the updated body (if any) and the updated sidecar; leave
		// needsAnswers: true. The sidecar stays present with its pending entries.
		if (itemBody !== undefined) {
			writeFileSync(itemAbs, setNeedsAnswersMarker(itemBody, true));
		}
		mkdirSync(dirname(sidecarAbs), {recursive: true});
		writeFileSync(sidecarAbs, serialiseSidecar(sidecar));
		touched.push(sidecarPath);
	}

	// Stage exactly the two paths and commit them TOGETHER (one atomic commit).
	gitHard(['add', '--', ...touched], cwd, env);
	const subject = resolved
		? `advance: resolve ${sidecar.item} (by ${by})`
		: `advance: apply ${sidecar.item} (by ${by})`;
	gitHard(['commit', '--quiet', '-m', subject], cwd, env);
	const commit = gitHard(['rev-parse', 'HEAD'], cwd, env).stdout.trim();
	note(subject);

	return {
		outcome: resolved ? 'resolved' : 'repaused',
		commit,
		sidecarPath,
	};
}

/** Read the item body from disk (the resolve path with no supplied body). */
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
	// Fall back to the working-tree file (uncommitted item).
	try {
		return readFileSync(itemAbs, 'utf8');
	} catch {
		throw new ApplyAtomicError(
			`cannot read item body for '${itemPath}' (supply itemBody)`,
		);
	}
}
