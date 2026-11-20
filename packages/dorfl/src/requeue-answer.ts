import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {run} from './git.js';
import {applyAnsweredQuestions} from './apply-persist.js';
import {
	isEntryAnswered,
	parseSidecar,
	serialiseSidecar,
	sidecarPathFor,
	type SidecarModel,
} from './sidecar.js';
import {workItemRel, type WorkFolderKey} from './work-layout.js';

/**
 * `requeue <slug> -m "<note>"` on a SURFACED task: the note is the human's
 * answer to the question the surface asked, so it is written into the pending
 * sidecar entries and applied in the same step `advance` would (needsAnswers
 * cleared, the sidecar deleted, the answer recorded under `## Applied answers`),
 * plus the usual dated `## Requeue` section the continue prompt reads. One
 * command replaces "clone, answer the sidecar, push, `advance`".
 *
 * Built off `<arbiter>/main` in a throwaway DETACHED worktree (the caller's
 * tree, index and HEAD are never touched) and returned as a commit + a scratch
 * ref for the caller's ledger-seam CAS push, like every other tree-less requeue
 * write.
 */

/** The folders a task body may rest in while it is surfaced. */
const BODY_FOLDERS: readonly WorkFolderKey[] = ['tasks-ready', 'tasks-backlog'];

function git(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): {status: number; stdout: string; stderr: string} {
	const res = run('git', args, cwd, {env});
	return {status: res.status ?? 1, stdout: res.stdout, stderr: res.stderr};
}

function gitHard(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): string {
	const res = git(args, cwd, env);
	if (res.status !== 0) {
		throw new Error(
			`git ${args.join(' ')} failed (exit ${res.status}): ${res.stderr.trim()}`,
		);
	}
	return res.stdout;
}

/**
 * The task's sidecar on `commit` when it carries at least one UNANSWERED entry
 * (the item is surfaced and waiting on a human), else undefined. An unparseable
 * sidecar answers undefined: the requeue then falls back to the plain note and
 * never guesses at a file it cannot read.
 */
export function pendingSidecarOnCommit(params: {
	cwd: string;
	slug: string;
	commit: string;
	env: NodeJS.ProcessEnv | undefined;
}): SidecarModel | undefined {
	const {cwd, slug, commit, env} = params;
	const show = git(
		['show', `${commit}:${sidecarPathFor(`task:${slug}`)}`],
		cwd,
		env,
	);
	if (show.status !== 0) {
		return undefined;
	}
	try {
		const model = parseSidecar(show.stdout);
		return model.entries.some((e) => !isEntryAnswered(e)) ? model : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Build the answer-and-apply commit(s) for a surfaced task on top of `base`:
 * every pending sidecar entry is answered with `handoff`, the dated `## Requeue`
 * section is inserted into the body (`insertNote`, the same transform a plain
 * `requeue -m` uses), and the answered sidecar is applied (resolved). Returns the
 * scratch ref + head commit for the CAS push, `'not-surfaced'` when `base` has no
 * pending question for the task, or `'missing'` when the body rests in neither
 * `tasks/ready/` nor `tasks/backlog/`.
 */
export function prepareAnsweredRequeueCommit(params: {
	cwd: string;
	slug: string;
	base: string;
	handoff: string;
	insertNote: (body: string, note: string) => string;
	env: NodeJS.ProcessEnv | undefined;
}): {ref: string; commit: string} | 'not-surfaced' | 'missing' {
	const {cwd, slug, base, handoff, insertNote, env} = params;
	const pending = pendingSidecarOnCommit({cwd, slug, commit: base, env});
	if (pending === undefined) {
		return 'not-surfaced';
	}
	const bodyRel = BODY_FOLDERS.map((f) => workItemRel(f, `${slug}.md`)).find(
		(rel) => git(['cat-file', '-e', `${base}:${rel}`], cwd, env).status === 0,
	);
	if (bodyRel === undefined) {
		return 'missing';
	}

	const parent = mkdtempSync(join(tmpdir(), `dorfl-requeue-answer-${slug}-`));
	const worktree = join(parent, 'wt');
	gitHard(['worktree', 'add', '--quiet', '--detach', worktree, base], cwd, env);
	try {
		const item = `task:${slug}`;
		const sidecarRel = sidecarPathFor(item);
		// 1. The human's answer, in the human's words: every pending entry gets
		//    the note verbatim (an already-answered entry is never touched).
		writeFileSync(
			join(worktree, sidecarRel),
			serialiseSidecar({
				...pending,
				entries: pending.entries.map((e) =>
					isEntryAnswered(e) ? e : {...e, answer: handoff},
				),
			}),
		);
		// 2. The handoff section the continue prompt reads (`## Requeue`), placed
		//    mid-body so it never collides with a kept branch's done-record tail.
		const bodyAbs = join(worktree, bodyRel);
		writeFileSync(bodyAbs, insertNote(readFileSync(bodyAbs, 'utf8'), handoff));
		gitHard(['add', '--', sidecarRel, bodyRel], worktree, env);
		gitHard(
			[
				'commit',
				'-q',
				'-m',
				`chore(${slug}): requeue answers the surfaced question`,
			],
			worktree,
			env,
		);
		// 3. Apply it exactly as `advance` would.
		const applied = applyAnsweredQuestions({
			cwd: worktree,
			item,
			itemPath: bodyRel,
			env,
		});
		if (applied.outcome !== 'resolved') {
			throw new Error(
				`applying the requeue answer for ${item} ended '${applied.outcome}', not resolved`,
			);
		}
		const commit = gitHard(['rev-parse', 'HEAD'], worktree, env).trim();
		const ref = `refs/dorfl/requeue-answer/${slug}`;
		gitHard(['update-ref', ref, commit], cwd, env);
		return {ref, commit};
	} finally {
		git(['worktree', 'remove', '--force', worktree], cwd, env);
		rmSync(parent, {recursive: true, force: true});
		git(['worktree', 'prune'], cwd, env);
	}
}
