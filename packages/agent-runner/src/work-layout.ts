import {join} from 'node:path';

/**
 * The **work-layout** module: the SOLE source of every `work/...` path string,
 * folder-name union/array, the item-scan predicate, and the prefix-slice helpers
 * used across `src/`.
 *
 * This is Phase 0 of the `folder-taxonomy-reorg-and-rename` brief — the de-risking
 * checkpoint. EVERY raw work-path literal (`join(cwd, 'work', ...)`, `'work/<folder>'`,
 * `'work/<folder>/'.length` prefix-slices) and EVERY folder-name union/array that
 * used to be scattered across ~70 files now routes through here. The NAMES are
 * byte-identical to today (no rename, no behaviour change); only the SOURCE of the
 * string has moved into this one module.
 *
 * The whole point of the seam: the LATER rename tasks flip the VALUES in
 * {@link WORK_FOLDER_NAME} (and `git mv` the on-disk folders) and NOTHING ELSE.
 * Call sites reference folders by their SYMBOLIC key (`'tasks-todo'`,
 * `'briefs-ready'`, …), never by a raw string, so renaming a folder never
 * re-touches a single call site.
 *
 * Domain note (crown-jewel invariant): a `work/` tree is a set of governance
 * folders where "status IS the folder" — a CAS `git mv` between durable folders is
 * the conflict-safe state machine. This module owns the folder NAMES that literally
 * are that state machine, so it is deliberately the one place a careless rename can
 * touch.
 *
 * The transient states (`in-progress`/`needs-attention`/`slicing`/`advancing`) are
 * NOT folders — they are per-item lock-ref state (see `item-lock.ts`). A stray
 * `in-progress` literal still referenced by some legacy/recovery readers routes
 * through this module like any other folder, but is NOT part of the durable
 * folder-as-status set.
 */

/**
 * The repo-relative root of the `work/` governance tree. The single literal `'work'`
 * the whole package shares — every path builder below is rooted here.
 */
export const WORK_ROOT = 'work' as const;

/**
 * Every work-folder SYMBOLIC KEY → its current on-disk folder NAME (byte-identical
 * to today). This is the ONE place a folder name lives; the later taxonomy rename is
 * a value-only flip of the right-hand side here.
 *
 * Folder kinds (kept here as a single registry, but their distinct roles matter):
 *   - TASK lifecycle, the `tasks/` Kanban board: `tasks/backlog` (staging, key
 *     `tasks-backlog`) → `tasks/todo` (the agent pool, key `tasks-todo`) →
 *     `tasks/done` / `tasks/cancelled` (the PER-REGIME won't-proceed terminal, key
 *     `cancelled`).
 *   - BRIEF lifecycle, the `briefs/` regime: `briefs/proposed` (staging, key
 *     `briefs-proposed`) → `briefs/ready` (auto-task pool, key `briefs-ready`) →
 *     `briefs/tasked` (tasked, resting, key `briefs-tasked`) / `briefs/dropped`
 *     (the PER-REGIME won't-proceed terminal, key `briefs-dropped`).
 *   - The PER-REGIME won't-proceed terminals (`tasks/cancelled` + `briefs/dropped`)
 *     replace the previous shared top-level `work/dropped/`: a dropped task and a
 *     dropped brief sharing a slug used to COLLIDE on one bare-slug
 *     `work/dropped/<slug>.md`; namespacing each regime's terminal removes the
 *     collision. A dropped OBSERVATION needs no terminal — notes leave by deletion.
 *   - Capture buckets under the `notes/` umbrella (do NOT flow; leave by deletion):
 *     `notes/observations` / `notes/ideas` / `notes/findings`.
 *   - Top-level surfaces: `questions` (the "what needs me?" queue), `protocol`
 *     (propagated protocol docs). NEITHER is folded under an umbrella.
 *   - The stray transient `in-progress` still referenced by legacy/recovery readers
 *     and `needs-attention` (both are really lock-ref state, NOT durable folders;
 *     routed here only so no reader hand-writes the literal).
 *
 * NOTE on the symbolic-key vocabulary cutover
 * (`work-layout-keys-and-folder-union-names-to-new-vocabulary`): the KEYS below now
 * read in the NEW task/brief vocabulary (`tasks-backlog`/`tasks-todo`,
 * `briefs-proposed`/`briefs-ready`/`briefs-tasked`). This is a PURE in-code symbol
 * rename — the VALUE strings are byte-identical to before, so no on-disk folder
 * moved. An earlier sibling task (`folder-taxonomy-reorg-and-rename` Phase 1)
 * flipped the VALUES (`tasks/todo`, `briefs/ready`, …) while deliberately leaving
 * the KEYS on the old words; this task flips only the KEYS so the registry reads
 * coherently. The folder-as-status invariant and every resolved path are unchanged.
 */
export const WORK_FOLDER_NAME = {
	'tasks-backlog': 'tasks/backlog',
	'tasks-todo': 'tasks/todo',
	'in-progress': 'in-progress',
	'needs-attention': 'needs-attention',
	done: 'tasks/done',
	cancelled: 'tasks/cancelled',
	'briefs-proposed': 'briefs/proposed',
	'briefs-ready': 'briefs/ready',
	'briefs-tasked': 'briefs/tasked',
	'briefs-dropped': 'briefs/dropped',
	observations: 'notes/observations',
	ideas: 'notes/ideas',
	findings: 'notes/findings',
	questions: 'questions',
	protocol: 'protocol',
} as const;

/** The SYMBOLIC KEY of a work folder (stable across the later rename). */
export type WorkFolderKey = keyof typeof WORK_FOLDER_NAME;

/**
 * Resolve a folder's current on-disk NAME from its symbolic key. The ONE accessor
 * every other folder-name lookup derives from, so the rename flips it in lockstep.
 */
export function workFolderName(folder: WorkFolderKey): string {
	return WORK_FOLDER_NAME[folder];
}

/**
 * Absolute path of a work folder under a repo/cwd root:
 * `<root>/work/<folder-name>`. Replaces every `join(cwd, 'work', '<folder>')` and
 * `join(repoPath, 'work', folder)` call site.
 */
export function workFolderPath(root: string, folder: WorkFolderKey): string {
	return join(root, WORK_ROOT, workFolderName(folder));
}

/**
 * Absolute path of a single item's `.md` file in a work folder:
 * `<root>/work/<folder-name>/<slug>.md`. Replaces every
 * `join(cwd, 'work', folder, `${slug}.md`)` call site. `slug` is the bare slug
 * (the `.md` suffix is appended here).
 */
export function workItemPath(
	root: string,
	folder: WorkFolderKey,
	slug: string,
): string {
	return join(root, WORK_ROOT, workFolderName(folder), `${slug}.md`);
}

/**
 * REPO-RELATIVE path of a work folder: `work/<folder-name>` (no trailing slash, no
 * root). The form used for `git mv` / `git`-relative paths and the staging/pool dir
 * constants (`STAGED_TASKS_DIR`, etc.). Replaces raw `'work/<folder>'` literals.
 */
export function workFolderRel(folder: WorkFolderKey): string {
	return `${WORK_ROOT}/${workFolderName(folder)}`;
}

/**
 * REPO-RELATIVE path of a single item file: `work/<folder-name>/<basename>`. The
 * `basename` is a full filename (caller decides whether it carries `.md`), matching
 * the existing `join('work', folder, '<file>')` call sites that pass either a
 * `${slug}.md` or a pre-suffixed name.
 */
export function workItemRel(folder: WorkFolderKey, basename: string): string {
	return `${WORK_ROOT}/${workFolderName(folder)}/${basename}`;
}

/**
 * The REPO-RELATIVE folder PREFIX (WITH trailing slash): `work/<folder-name>/`. The
 * form a reader matches with `startsWith(...)` and slices off to recover a filename
 * (see {@link stripWorkFolderPrefix}). Replaces hand-written `'work/<folder>/'`
 * literals and their `.length` prefix-slices.
 */
export function workFolderPrefix(folder: WorkFolderKey): string {
	return `${workFolderRel(folder)}/`;
}

/**
 * Recover the filename portion of a repo-relative path that lives DIRECTLY under a
 * work folder, by stripping its `work/<folder-name>/` prefix. Replaces the
 * hand-written `path.slice('work/<folder>/'.length)` prefix-slice. Returns
 * `undefined` when `path` is not under that folder, so callers that already
 * `startsWith`-guarded keep their exact behaviour (and callers that did not can
 * branch on `undefined` instead of slicing a wrong length).
 */
export function stripWorkFolderPrefix(
	path: string,
	folder: WorkFolderKey,
): string | undefined {
	const prefix = workFolderPrefix(folder);
	return path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
}

/**
 * The ITEM-SCAN predicate: does this directory entry NAME count as a `work/` item?
 * Defined ONCE here so no reader re-implements the `.md` filter. Case-insensitive
 * on the extension, matching every existing `name.toLowerCase().endsWith('.md')`
 * call site verbatim.
 */
export function isWorkItemFile(name: string): boolean {
	return name.toLowerCase().endsWith('.md');
}

// --- Folder-name unions / arrays (one definition, derived from the registry) --

/**
 * The TASK-RESOLUTION folders `resolveTask` (prompt.ts) walks, in precedence
 * order: `in-progress` over `tasks-todo`, with `done` appended only behind the
 * stranded-continue gate. Order is load-bearing — kept exactly as the original
 * union/array.
 */
export const TASK_RESOLUTION_FOLDERS = [
	'in-progress',
	'tasks-todo',
	'done',
] as const satisfies readonly WorkFolderKey[];

/** One of the folders a task can be RESOLVED from (prompt.ts `TaskFolder`). */
export type TaskResolutionFolder = (typeof TASK_RESOLUTION_FOLDERS)[number];

/**
 * The task LIFECYCLE folders a `task:<slug>` / lone-task `issue:` can reside
 * in (brief-complete.ts + close-job.ts `TASK_FOLDERS`): `tasks-todo`, `in-progress`,
 * `needs-attention`, `done`.
 */
export const TASK_LIFECYCLE_FOLDERS = [
	'tasks-todo',
	'in-progress',
	'needs-attention',
	'done',
] as const satisfies readonly WorkFolderKey[];

/** One of the task lifecycle folders (brief-complete.ts / close-job.ts). */
export type TaskLifecycleFolder = (typeof TASK_LIFECYCLE_FOLDERS)[number];

/**
 * The DURABLE task-status folders the ledger lint / integration core treat as the
 * one-slug-one-folder state machine: `tasks-todo`, `done`, `cancelled`
 * (ledger-lint.ts + integration-core.ts `LEDGER_STATUS_FOLDERS`). The transient
 * `in-progress`/`needs-attention`/`slicing` are NOT here (they are lock-ref state).
 * `cancelled` is the task regime's won't-proceed terminal (the per-regime split
 * of the previous shared `dropped/`); the brief regime's terminal `briefs-dropped`
 * is NOT here (this set is the TASK board's state machine, keyed by `tasks/`-slug,
 * and a brief never co-resides with a task on the tasks board).
 */
export const LEDGER_STATUS_FOLDERS = [
	'tasks-todo',
	'done',
	'cancelled',
] as const satisfies readonly WorkFolderKey[];

/** One of the durable ledger status folders (ledger-lint.ts / integration-core.ts). */
export type LedgerStatusFolder = (typeof LEDGER_STATUS_FOLDERS)[number];

/**
 * The BRIEF-lifecycle folders an `issue:`-bearing brief / a tasked brief can reside
 * in: `briefs-ready` (source / pool), `briefs-tasked` (tasked, resting) —
 * close-job.ts `BRIEF_FOLDERS`.
 */
export const BRIEF_FOLDERS = [
	'briefs-ready',
	'briefs-tasked',
] as const satisfies readonly WorkFolderKey[];

/** One of the brief-lifecycle folders (close-job.ts / ledger-read.ts). */
export type BriefFolder = (typeof BRIEF_FOLDERS)[number];
