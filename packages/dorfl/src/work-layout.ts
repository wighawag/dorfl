import {join} from 'node:path';

/**
 * The **work-layout** module: the SOLE source of every `work/...` path string,
 * folder-name union/array, the item-scan predicate, and the prefix-task helpers
 * used across `src/`.
 *
 * This is Phase 0 of the `folder-taxonomy-reorg-and-rename` spec — the de-risking
 * checkpoint. EVERY raw work-path literal (`join(cwd, 'work', ...)`, `'work/<folder>'`,
 * `'work/<folder>/'.length` prefix-tasks) and EVERY folder-name union/array that
 * used to be scattered across ~70 files now routes through here. The NAMES are
 * byte-identical to today (no rename, no behaviour change); only the SOURCE of the
 * string has moved into this one module.
 *
 * The whole point of the seam: the LATER rename tasks flip the VALUES in
 * {@link WORK_FOLDER_NAME} (and `git mv` the on-disk folders) and NOTHING ELSE.
 * Call sites reference folders by their SYMBOLIC key (`'tasks-ready'`,
 * `'specs-ready'`, …), never by a raw string, so a folder-VALUE flip never
 * re-touches a single call site (a KEY rename, e.g. the spec→spec cutover below,
 * is a mechanical relabel of the key literal at each site — behaviour-preserving).
 *
 * Domain note (crown-jewel invariant): a `work/` tree is a set of governance
 * folders where "status IS the folder" — a CAS `git mv` between durable folders is
 * the conflict-safe state machine. This module owns the folder NAMES that literally
 * are that state machine, so it is deliberately the one place a careless rename can
 * touch.
 *
 * The transient states (`in-progress`/`needs-attention`/`tasking`/`advancing`) are
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
 *     `tasks-backlog`) → `tasks/ready` (the agent pool, key `tasks-ready`) →
 *     `tasks/done` / `tasks/cancelled` (the PER-REGIME won't-proceed terminal, key
 *     `cancelled`).
 *   - SPEC lifecycle, the `specs/` regime: `specs/proposed` (staging, key
 *     `specs-proposed`) → `specs/ready` (auto-task pool, key `specs-ready`) →
 *     `specs/tasked` (tasked, resting, key `specs-tasked`) / `specs/dropped`
 *     (the PER-REGIME won't-proceed terminal, key `specs-dropped`).
 *   - The PER-REGIME won't-proceed terminals (`tasks/cancelled` + `specs/dropped`)
 *     replace the previous shared top-level `work/dropped/`: a dropped task and a
 *     dropped spec sharing a slug used to COLLIDE on one bare-slug
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
 * NOTE on the spec→spec vocabulary cutover
 * (`rename-spec-work-layout-and-folders`, migrate-batch 1 of
 * `prd-to-spec-vocabulary-cutover-and-migration-command`): the spec-regime KEYS
 * below now read in the `spec` vocabulary (`specs-proposed`/`specs-ready`/
 * `specs-tasked`/`specs-dropped`) AND their VALUES flip to `work/specs/*` in
 * lockstep with the on-disk `git mv work/specs/* → work/specs/*`. Unlike the earlier
 * key-only relabel, this batch moves the folders too, so the KEY and VALUE change
 * together and the self-renaming-folder guard stays green. The KEY rename is a
 * mechanical relabel of the key literal at each call site (behaviour-preserving);
 * the frontmatter `prd:` field (a DATA alias the migration command converts) is the
 * one deliberate survivor; the `--specs-land-in` flag/`specsLandIn` config + the
 * `Spec*` symbols were completed by the later batches + the contract task. The
 * folder-as-status invariant is unchanged.
 */
export const WORK_FOLDER_NAME = {
	'tasks-backlog': 'tasks/backlog',
	'tasks-ready': 'tasks/ready',
	'in-progress': 'in-progress',
	'needs-attention': 'needs-attention',
	done: 'tasks/done',
	cancelled: 'tasks/cancelled',
	'specs-proposed': 'specs/proposed',
	'specs-ready': 'specs/ready',
	'specs-tasked': 'specs/tasked',
	'specs-dropped': 'specs/dropped',
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
 * form a reader matches with `startsWith(...)` and tasks off to recover a filename
 * (see {@link stripWorkFolderPrefix}). Replaces hand-written `'work/<folder>/'`
 * literals and their `.length` prefix-tasks.
 */
export function workFolderPrefix(folder: WorkFolderKey): string {
	return `${workFolderRel(folder)}/`;
}

/**
 * Recover the filename portion of a repo-relative path that lives DIRECTLY under a
 * work folder, by stripping its `work/<folder-name>/` prefix. Replaces the
 * hand-written `path.slice('work/<folder>/'.length)` prefix-task. Returns
 * `undefined` when `path` is not under that folder, so callers that already
 * `startsWith`-guarded keep their exact behaviour (and callers that did not can
 * branch on `undefined` instead of tasking a wrong length).
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
 * order: `in-progress` over `tasks-ready`, with `done` appended only behind the
 * stranded-continue gate. Order is load-bearing — kept exactly as the original
 * union/array. (`tasks-backlog` is NOT in this DEFAULT order: it is appended at
 * the LOWEST priority ONLY behind the explicit `--allow-backlog` flag, spec
 * `do-allow-backlog-drive-staged-tasks-without-promotion` — see
 * {@link TaskResolutionFolder}.)
 */
export const TASK_RESOLUTION_FOLDERS = [
	'in-progress',
	'tasks-ready',
	'done',
] as const satisfies readonly WorkFolderKey[];

/**
 * One of the folders a task can be RESOLVED from (prompt.ts `TaskFolder`): the
 * default {@link TASK_RESOLUTION_FOLDERS} PLUS `tasks-backlog`, which is reachable
 * ONLY behind the explicit `--allow-backlog` flag (never on a default resolution).
 * Kept off the default-order array on purpose so no autonomous path resolves
 * staging.
 */
export type TaskResolutionFolder =
	| (typeof TASK_RESOLUTION_FOLDERS)[number]
	| 'tasks-backlog';

/**
 * The task LIFECYCLE folders a `task:<slug>` / lone-task `issue:` can reside
 * in (spec-complete.ts + close-job.ts `TASK_FOLDERS`): `tasks-ready`, `in-progress`,
 * `needs-attention`, `done`.
 */
export const TASK_LIFECYCLE_FOLDERS = [
	'tasks-ready',
	'in-progress',
	'needs-attention',
	'done',
] as const satisfies readonly WorkFolderKey[];

/** One of the task lifecycle folders (spec-complete.ts / close-job.ts). */
export type TaskLifecycleFolder = (typeof TASK_LIFECYCLE_FOLDERS)[number];

/**
 * The DURABLE task-status folders the ledger lint / integration core treat as the
 * one-slug-one-folder state machine: `tasks-ready`, `done`, `cancelled`
 * (ledger-lint.ts + integration-core.ts `LEDGER_STATUS_FOLDERS`). The transient
 * `in-progress`/`needs-attention`/`tasking` are NOT here (they are lock-ref state).
 * `cancelled` is the task regime's won't-proceed terminal (the per-regime split
 * of the previous shared `dropped/`); the spec regime's terminal `specs-dropped`
 * is NOT here (this set is the TASK board's state machine, keyed by `tasks/`-slug,
 * and a spec never co-resides with a task on the tasks board).
 */
export const LEDGER_STATUS_FOLDERS = [
	'tasks-ready',
	'done',
	'cancelled',
] as const satisfies readonly WorkFolderKey[];

/** One of the durable ledger status folders (ledger-lint.ts / integration-core.ts). */
export type LedgerStatusFolder = (typeof LEDGER_STATUS_FOLDERS)[number];

/**
 * The SPEC-lifecycle folders an `issue:`-bearing spec / a tasked spec can reside
 * in: `specs-ready` (source / pool), `specs-tasked` (tasked, resting) —
 * close-job.ts `SPEC_FOLDERS`.
 */
export const SPEC_FOLDERS = [
	'specs-ready',
	'specs-tasked',
] as const satisfies readonly WorkFolderKey[];

/** One of the spec-lifecycle folders (close-job.ts / ledger-read.ts). */
export type SpecFolder = (typeof SPEC_FOLDERS)[number];
