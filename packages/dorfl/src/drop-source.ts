import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {run, type RunResult} from './git.js';
import {resolveSidecarIdentity, sidecarPathFor} from './sidecar.js';
import {resolveItemPathByIdentity} from './item-path.js';

/**
 * The DIRECT-DELETE helper (spec
 * `agentic-question-resolution-retire-disposition-vocabulary`, US #5/#11; task
 * `direct-delete-question-cli-helper`) — the "I just want to throw this away"
 * path that `git rm`s a source item AND its question sidecar (when present) in
 * ONE revertible commit, the human's reason recorded in the commit MESSAGE (git
 * history is the archive).
 *
 * It is the DIRECT human/skill/CLI action of decision 7: the human, the
 * `answer-questions` skill, or the `dorfl drop` verb deletes a signal STRAIGHT —
 * it does NOT round-trip through the decision engine or spawn any agent. (The
 * AGENT reaching `delete-source` as a verdict is the SEPARATE engine path in
 * `apply-persist.ts`'s `dischargeByDeletion`; this module is its no-engine twin.)
 *
 * The shape deliberately MIRRORS `apply-persist.ts`'s `dischargeByDeletion` (same
 * one-commit `git rm`, same reason-in-the-message archive) but reaches it WITHOUT
 * the answered-sidecar precondition, the apply rung, or any verdict: the human
 * has already decided. Both the source path and the sidecar path are resolved by
 * the item's namespaced IDENTITY (the single source of truth) via the SHARED
 * `resolveItemPathByIdentity` / `sidecarPathFor` resolvers — NOT a captured path.
 *
 * Git-recoverable by construction: a single revertible commit, so a wrong delete
 * is never catastrophic (US #11).
 */

export interface DropSourceOptions {
	/** Working clone/worktree the deletion commits in. */
	cwd: string;
	/**
	 * The namespaced item identity to delete (`task:foo` / `prd:bar` /
	 * `observation:baz` / `obs:baz` / a bare `<slug>` = task). Resolved to its
	 * on-disk path by identity, folder-agnostic.
	 */
	item: string;
	/**
	 * The human's reason for the deletion, recorded in the commit MESSAGE (git
	 * history is the archive). Empty/whitespace is recorded as "(no reason given)"
	 * rather than refused — the human asked to delete; the reason is documentation,
	 * not a gate.
	 */
	reason?: string;
	/** Advisory committer id for the commit subject. Defaults to git user.name. */
	by?: string;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

/** The terminal a drop reached. */
export type DropTerminal =
	/** The source (+ its sidecar when present) were `git rm`-ed in one commit. */
	| 'deleted'
	/**
	 * No source resolved by identity in any lifecycle folder — nothing to delete.
	 * A clean no-op (no commit), NOT an error: the human asked to throw away
	 * something that is already gone, and the sidecar (if any) is the orphan-gc
	 * sweep's concern, not this direct verb's.
	 */
	| 'not-found';

export interface DropSourceResult {
	/** The terminal the drop reached. */
	outcome: DropTerminal;
	/** The canonical namespaced identity the drop acted on. */
	item: string;
	/** The commit sha the drop produced (only on `deleted`). */
	commit?: string;
	/** The source path (relative to `cwd`) that was removed (only on `deleted`). */
	itemPath?: string;
	/**
	 * The sidecar path (relative to `cwd`) that was removed, or `undefined` when
	 * no sidecar was present (a source with no open-question conversation).
	 */
	sidecarPath?: string;
	/** A human-readable summary. */
	message: string;
}

/** Raised for usage errors (a missing repo). */
export class DropSourceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DropSourceError';
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
		throw new DropSourceError(
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
 * DELETE a source item + its question sidecar DIRECTLY (US #5/#11): `git rm` the
 * source AND its sidecar (when present) in ONE revertible commit, the human's
 * `reason` recorded in the commit MESSAGE. No decision engine, no agent — the
 * direct human/skill/CLI throw-it-away path.
 *
 *   - Resolves the source by IDENTITY (`resolveItemPathByIdentity`); when it is
 *     already gone, returns `not-found` as a clean no-op (no commit) — deleting
 *     something already absent is "nothing to throw away", not a failure.
 *   - `git rm`s the sidecar TOO when one is present (`sidecarPathFor` →
 *     `existsSync`); a source with no open-question conversation simply has no
 *     sidecar to remove.
 *   - Both ride ONE commit, so the deletion is a single revertible unit (a wrong
 *     delete is recoverable via `git revert`).
 */
export function dropSource(options: DropSourceOptions): DropSourceResult {
	const {cwd, env} = options;
	const note = options.note ?? (() => {});

	if (gitSoft(['rev-parse', '--git-dir'], cwd, env).status !== 0) {
		throw new DropSourceError('not inside a git repository');
	}

	// Canonicalise the identity (bare slug → task, `obs:` → observation, …) so the
	// commit message + result speak the one namespaced form.
	const {item} = resolveSidecarIdentity(options.item);

	const itemPath = resolveItemPathByIdentity(cwd, item);
	if (itemPath === undefined) {
		const message =
			`drop ${item}: no source item resolves by identity in any lifecycle ` +
			`folder — nothing to throw away (clean no-op, no commit).`;
		note(message);
		return {outcome: 'not-found', item, message};
	}

	// `git rm` the source. The sidecar may or may not exist (only items with an
	// open-question conversation have one); rm it too when present, so the drop
	// leaves no orphaned sidecar. Both ride ONE commit.
	const sidecarPath = sidecarPathFor(item);
	const sidecarPresent = existsSync(join(cwd, sidecarPath));
	const rmPaths = sidecarPresent ? [itemPath, sidecarPath] : [itemPath];
	gitHard(['rm', '--quiet', '--', ...rmPaths], cwd, env);

	const by = options.by || resolveBy(cwd, env);
	const reasonLine =
		(options.reason ?? '').trim() === ''
			? '(no reason given)'
			: (options.reason ?? '').trim();
	const subject = `drop: ${item} → deleted (by ${by})`;
	const messageBody =
		`Direct delete (the human threw it away; no engine round-trip; git ` +
		`history is the archive). This is a single revertible commit.\n\n` +
		`reason: ${reasonLine}`;
	gitHard(['commit', '--quiet', '-m', subject, '-m', messageBody], cwd, env);
	const commit = gitHard(['rev-parse', 'HEAD'], cwd, env).stdout.trim();

	const message =
		`dropped ${item} → deleted (source${sidecarPresent ? ' + sidecar' : ''} ` +
		`git rm-ed in one revertible commit; reason in the commit message).`;
	note(message);
	return {
		outcome: 'deleted',
		item,
		commit,
		itemPath,
		...(sidecarPresent ? {sidecarPath} : {}),
		message,
	};
}
