import {readdirSync, readFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {parseFrontmatter} from './frontmatter.js';
import {
	TASK_LIFECYCLE_FOLDERS,
	type TaskLifecycleFolder,
	workFolderPath,
	workItemRel,
	isWorkItemFile,
} from './work-layout.js';

/**
 * The read-only **"is this spec complete?"** core query (spec `issue-intake`, US #8 —
 * the closure-linkage half). Given a spec slug + a `work/` tree, a spec is COMPLETE
 * iff there is **≥1 task carrying `spec:<slug>` in `work/tasks/done/`** AND **every
 * other such task is in `work/tasks/cancelled/`**. A task that names the spec
 * ANYWHERE else (staged in `tasks/backlog/`, in `tasks/ready/`, in progress) keeps
 * the spec incomplete; a cancelled task does not block completion, but a spec whose
 * tasks are ALL cancelled (none done) is NOT complete (reported as
 * {@link SpecCompleteResult.allCancelled}, so the close-job never closes its issue
 * as `completed`). Pure `work/`-folder logic — no seam, no git, no `gh`, no mutation.
 *
 * This is the LINKAGE the intake engine emits for CI to ACT on: a spec fans out to N
 * tasks = N PRs whose tasks carry `spec:` ONLY (no `Refs #N` keyword is emitted),
 * and the issue is closed by CI's merge-to-main JOB that runs THIS query +
 * `closeIssue`. That close JOB is `runner-in-ci`'s — NOT
 * built here; this module exposes ONLY the query for the job to call. The issue
 * number lives ONLY on the spec (`issue:`); tasks link via `task.spec: → spec`, so
 * this query keys on the SAME `spec:` field that hop uses.
 *
 * It is a `work/`-FOLDER RESIDENCE scan keyed on the parsed `spec:` field — NOT the
 * claim ledger (`ledger-read.ts` resolves claim-STATE, a different concern). It
 * reuses {@link parseFrontmatter} (the `spec:` field) rather than hand-rolling a YAML
 * parse, and scans EVERY task lifecycle folder directly ({@link TASK_LIFECYCLE_FOLDERS}:
 * backlog, ready, in-progress, done, cancelled). Task
 * `spec-complete-counts-staged-and-cancelled-tasks`: the scan used to skip
 * `tasks/backlog/`, so a spec whose tasks were still staged read as complete as
 * soon as its first task landed.
 */

/** The task lifecycle folders a `spec:<slug>` task can reside in. */
const TASK_FOLDERS = TASK_LIFECYCLE_FOLDERS;

/** Where a task resides — the folder name under `work/`. */
type TaskFolder = TaskLifecycleFolder;

/** What the query needs: which repo's `work/` tree to scan + which spec slug. */
export interface SpecCompleteInput {
	/** The repo working-tree root whose `work/` task folders to scan. */
	repoPath: string;
	/** The spec slug to check (matched against each task's frontmatter `spec:`). */
	slug: string;
}

/** One task carrying `spec:<slug>`, with the folder it resides in. */
export interface SpecTask {
	/** Filename within `work/<folder>/` (e.g. `add-quiet-flag.md`). */
	file: string;
	/** The task's resolved slug (frontmatter `slug:`, falling back to filename). */
	slug: string;
	/** Which task folder it resides in. */
	folder: TaskFolder;
}

/**
 * The result of the "is this spec complete?" query. {@link complete} is the
 * load-bearing verdict; {@link tasks} surfaces the matched set (with residence)
 * so a caller can explain the verdict if it wants to.
 */
export interface SpecCompleteResult {
	/**
	 * `true` iff ≥1 `spec:<slug>` task resides in `work/tasks/done/` AND every other
	 * such task resides in `work/tasks/cancelled/`. `false` when no task carries the
	 * slug, when any matching task is still open (backlog / ready / in-progress), or
	 * when every matching task is cancelled (see {@link allCancelled}).
	 */
	complete: boolean;
	/**
	 * `true` iff ≥1 task carries `spec:<slug>` AND every one of them is in
	 * `work/tasks/cancelled/` (none done): the spec did not complete, it was
	 * abandoned. Never `true` together with {@link complete}.
	 */
	allCancelled: boolean;
	/** Every task carrying `spec:<slug>`, across all task folders, sorted by slug. */
	tasks: SpecTask[];
}

/** List the `.md` filenames in `<repoPath>/work/<folder>/`, sorted; `[]` if absent. */
function listMarkdown(repoPath: string, folder: TaskFolder): string[] {
	const dir = workFolderPath(repoPath, folder);
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries.filter((name) => isWorkItemFile(name)).sort();
}

/**
 * Is this spec COMPLETE? Read-only: scan every task lifecycle folder, parse each
 * task's `spec:` via {@link parseFrontmatter}, keep those whose `spec:` equals
 * `slug`, and return COMPLETE iff ≥1 member resides in `work/tasks/done/` and EVERY
 * member resides in `work/tasks/done/` or `work/tasks/cancelled/`. Touches no git, no network, no mutation — a pure `work/`-folder
 * residence scan keyed on the parsed `spec:` field.
 */
export function isSpecComplete(input: SpecCompleteInput): SpecCompleteResult {
	const {repoPath, slug} = input;
	const tasks: SpecTask[] = [];
	for (const folder of TASK_FOLDERS) {
		for (const file of listMarkdown(repoPath, folder)) {
			const content = readFileSync(
				join(repoPath, workItemRel(folder, file)),
				'utf8',
			);
			const fm = parseFrontmatter(content);
			if (fm.spec === slug) {
				tasks.push({
					file,
					slug: fm.slug ?? basename(file, '.md'),
					folder,
				});
			}
		}
	}
	tasks.sort((a, b) => a.slug.localeCompare(b.slug));

	// COMPLETE iff ≥1 such task is done AND every one of them is done or
	// cancelled. A staged/ready/in-progress task keeps it open; an all-cancelled
	// set is NOT complete (nothing was delivered).
	const settled = tasks.every(
		(s) => s.folder === 'done' || s.folder === 'cancelled',
	);
	const anyDone = tasks.some((s) => s.folder === 'done');
	const complete = settled && anyDone;
	const allCancelled =
		tasks.length > 0 && tasks.every((s) => s.folder === 'cancelled');
	return {complete, allCancelled, tasks};
}
