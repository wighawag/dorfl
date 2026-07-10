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
 * The read-only **"is this spec complete?"** core query (prd `issue-intake`, US #8 —
 * the closure-linkage half). Given a spec slug + a `work/` tree, a spec is COMPLETE
 * iff there is **≥1 task carrying `spec:<slug>`** AND **all such tasks reside in
 * `work/done/`**. Pure `work/`-folder logic — no seam, no git, no `gh`, no mutation.
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
 * parse, and scans the task lifecycle folders directly: `work/tasks/ready/`,
 * `work/in-progress/`, `work/needs-attention/`, and `work/done/`. A task that has
 * NOT yet landed in `work/done/` (still in backlog / in-progress / needs-attention)
 * means the spec is not yet complete.
 */

/** The task lifecycle folders a `prd:<slug>` task can reside in. */
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
	 * `true` iff ≥1 task carries `spec:<slug>` AND every such task resides in
	 * `work/done/`. `false` when no task carries the slug (≥1 is REQUIRED) OR when
	 * any matching task is still outside `work/done/`.
	 */
	complete: boolean;
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
 * Is this spec COMPLETE? Read-only: scan the task lifecycle folders, parse each
 * task's `spec:` via {@link parseFrontmatter}, keep those whose `spec:` equals
 * `slug`, and return COMPLETE iff that set is NON-EMPTY and EVERY member resides in
 * `work/done/`. Touches no git, no network, no mutation — a pure `work/`-folder
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

	// COMPLETE iff ≥1 such task AND every one of them is in `work/done/`.
	const complete = tasks.length > 0 && tasks.every((s) => s.folder === 'done');
	return {complete, tasks};
}
