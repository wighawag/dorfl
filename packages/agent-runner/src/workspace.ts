import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {git} from './git.js';
import {
	encodeRepoKey,
	ensureMirror,
	type EnsureMirrorResult,
} from './repo-mirror.js';
import {type HarnessRecord} from './harness.js';

/**
 * The workspace manager (ADR §2): one git worktree per **job** (a claimed work
 * item being processed), checked out OUTSIDE the bare hub mirror at
 * `<workspacesDir>/work/<work-id>/`, on branch `work/<slug>`, branched off the
 * hub's freshly-fetched `main`.
 *
 * This is the single isolation primitive (ADR §1: jobs-not-agents) — both the
 * autonomous `run-once` runner and (later) the human `work-on` build on it. It
 * consumes the **`repo-mirror`** hub primitive (it does NOT reimplement mirror
 * management or the repo→key encoding) and leaves a `.agent-runner-job.json`
 * record + the worktree on disk for `gc`/`status` to read (those are SEPARATE
 * slices — this slice only provides the state they evaluate).
 *
 * `<workspacesDir>` is STATE, not cache (ADR §3): it lives under a single
 * visible `~/.agent-runner/`, never `~/.cache`.
 */

/** The on-disk JSON record `gc`/`status` read to evaluate a job. */
export interface JobRecord {
	/** The work slug being processed. */
	slug: string;
	/** The encoded repo key (the hub mirror key for the arbiter URL). */
	repoKey: string;
	/** The work branch checked out in the worktree (`work/<slug>`). */
	branch: string;
	/** ISO timestamp the job worktree was created. */
	startedAt: string;
	/** Lifecycle state; `gc`/`status` read this alongside the worktree's existence. */
	state: JobState;
	/** The harness block: how this job is launched + its liveness pointer. */
	harness: HarnessRecord;
}

/**
 * A job's lifecycle state, persisted in its record. The reaper (`gc`) and
 * `status` read it together with the worktree's existence (ADR §4); this slice
 * only ever sets `running` (and lets the harness/integration update it later).
 */
export type JobState =
	| 'running' // the worktree exists and the job is in flight
	| 'done' // work landed/pushed (integration succeeded)
	| 'needs-attention'; // stuck — a human must look (gate red, rebase conflict, …)

/**
 * Encode a flat, deterministic, unique-per-claim **work-id** from the arbiter
 * URL + slug: the hierarchical repo key with its `/` separators flattened to
 * `__`, then `__<slug>` appended (ADR §2). Flat (not hierarchical) so listing /
 * counting / GC of jobs is a flat `ls`. Reuses the `repo-mirror` repo→key
 * encoding (dot→dash per segment) — it does NOT duplicate it.
 *
 * E.g. `git@github.com:wighawag/agent-runner.git` + `feat`
 *   → `github-com__wighawag__agent-runner__feat`.
 */
export function encodeWorkId(url: string, slug: string): string {
	const key = encodeRepoKey(url).split('/').join('__');
	return `${key}__${slug}`;
}

/**
 * The on-disk location of a job's worktree: `<workspacesDir>/work/<work-id>/`.
 * Flat, OUTSIDE the hub (`<workspacesDir>/repos/...`), under `workspacesDir`
 * (default `~/.agent-runner`), never `~/.cache` (ADR §3).
 */
export function jobWorktreePath(
	workspacesDir: string,
	url: string,
	slug: string,
): string {
	return join(workspacesDir, 'work', encodeWorkId(url, slug));
}

/** Filename of the per-job record inside its worktree. */
export const JOB_RECORD_FILENAME = '.agent-runner-job.json';

export interface CreateJobOptions {
	/**
	 * The arbiter remote URL to mirror + branch from. Either `url` OR
	 * (`fromRepo` + `arbiter`) must be given; if both, `url` wins.
	 */
	url?: string;
	/** A working repo to resolve the arbiter URL from (with `arbiter`). */
	fromRepo?: string;
	/** Remote name in `fromRepo` whose URL to mirror (default `origin`). */
	arbiter?: string;
	/** The work slug being processed (→ branch `work/<slug>` + work-id). */
	slug: string;
	/** The execution working area (config `workspacesDir`, default `~/.agent-runner`). */
	workspacesDir: string;
	/** The initial harness block to persist in the record (default: null adapter). */
	harness?: HarnessRecord;
	env?: NodeJS.ProcessEnv;
}

export interface Job {
	/** Working directory the agent + tests run in (the worktree). */
	dir: string;
	/** The work branch checked out there (`work/<slug>`). */
	branch: string;
	/** The slug being processed. */
	slug: string;
	/**
	 * The git remote name VALID INSIDE the worktree that tracks the arbiter. A
	 * job worktree is cut from the bare hub mirror, whose clone remote is
	 * `origin` (pointing at the arbiter URL). So rebase/integrate inside the
	 * worktree always target `origin`, regardless of what the source working repo
	 * calls its arbiter remote.
	 */
	arbiterRemote: string;
	/** Absolute path to the per-job record. */
	recordPath: string;
	/** The persisted record. */
	record: JobRecord;
	/** The hub-mirror result this job was cut from. */
	mirror: EnsureMirrorResult;
	/**
	 * Remove the job's worktree + work branch from the hub (`git worktree remove`
	 * + prune; never a bare `rm -rf`, ADR §4). NOTE: the SAFE-to-delete predicate
	 * (ADR §4) is owned by the `gc` slice — this is only the mechanical teardown
	 * the runner uses after a job is provably saved.
	 */
	dispose(): void;
}

const DEFAULT_HARNESS: HarnessRecord = {adapter: 'null'};

/**
 * Create (or recreate) a job: ensure the hub mirror via `repo-mirror`, then
 * `git worktree add` a per-job worktree OUTSIDE the hub at
 * `<workspacesDir>/work/<work-id>/` on `work/<slug>`, branched off the
 * freshly-fetched `<hub>/main`. Writes the `.agent-runner-job.json` record.
 *
 * Distinct slugs ⇒ distinct `work/<slug>` branches, so git's one-branch-per-
 * worktree constraint is naturally avoided (ADR §2). If a stale worktree/branch
 * for this work-id already exists it is cleared first (idempotent re-create).
 */
export function createJob(options: CreateJobOptions): Job {
	const env = options.env;
	const mirror = ensureMirror({
		url: options.url,
		fromRepo: options.fromRepo,
		arbiter: options.arbiter,
		workspacesDir: options.workspacesDir,
		env,
	});

	const slug = options.slug;
	const branch = `work/${slug}`;
	const dir = jobWorktreePath(options.workspacesDir, mirror.url, slug);

	// Clear any stale registration for this work-id (idempotent re-create): a
	// leftover worktree dir or branch from a prior crashed run would block the
	// `worktree add`. We use git's own removal, never a bare rm -rf (ADR §4).
	clearStale(mirror.path, dir, branch, env);

	// Cut the worktree OUTSIDE the hub, on a fresh per-slug branch off the
	// freshly-fetched mirror main. `--force` is not used: the branch is unique.
	git(['worktree', 'add', '-b', branch, dir, 'main'], mirror.path, {env});

	const record: JobRecord = {
		slug,
		repoKey: encodeRepoKey(mirror.url),
		branch,
		startedAt: new Date().toISOString(),
		state: 'running',
		harness: options.harness ?? DEFAULT_HARNESS,
	};
	const recordPath = join(dir, JOB_RECORD_FILENAME);
	writeJobRecord(dir, record);

	return {
		dir,
		branch,
		slug,
		arbiterRemote: 'origin',
		recordPath,
		record,
		mirror,
		dispose() {
			git(['worktree', 'remove', '--force', dir], mirror.path, {env});
			pruneAndDropBranch(mirror.path, branch, env);
		},
	};
}

/** Write (or overwrite) a job's `.agent-runner-job.json` record. */
export function writeJobRecord(dir: string, record: JobRecord): void {
	writeFileSync(
		join(dir, JOB_RECORD_FILENAME),
		JSON.stringify(record, null, 2) + '\n',
	);
}

/** Read a job's record from its worktree, or `undefined` if absent/invalid. */
export function readJobRecord(dir: string): JobRecord | undefined {
	const path = join(dir, JOB_RECORD_FILENAME);
	if (!existsSync(path)) {
		return undefined;
	}
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as JobRecord;
	} catch {
		return undefined;
	}
}

/**
 * Update a job's record in place (e.g. flip `state` to `needs-attention` after a
 * rebase conflict), merging the patch over the on-disk record. A no-op if no
 * record exists.
 */
export function updateJobRecord(
	dir: string,
	patch: Partial<JobRecord>,
): JobRecord | undefined {
	const current = readJobRecord(dir);
	if (!current) {
		return undefined;
	}
	const next = {...current, ...patch};
	writeJobRecord(dir, next);
	return next;
}

/** Remove a stale worktree dir / branch registration before re-creating. */
function clearStale(
	mirrorPath: string,
	dir: string,
	branch: string,
	env: NodeJS.ProcessEnv | undefined,
): void {
	if (existsSync(dir)) {
		// Soft-remove: ignore errors (e.g. the dir is not a registered worktree).
		try {
			git(['worktree', 'remove', '--force', dir], mirrorPath, {env});
		} catch {
			// fall through to prune below
		}
	}
	pruneAndDropBranch(mirrorPath, branch, env);
}

/** Prune dangling worktree registrations + delete the work branch if present. */
function pruneAndDropBranch(
	mirrorPath: string,
	branch: string,
	env: NodeJS.ProcessEnv | undefined,
): void {
	try {
		git(['worktree', 'prune'], mirrorPath, {env});
	} catch {
		// best-effort
	}
	try {
		git(['branch', '-D', branch], mirrorPath, {env});
	} catch {
		// branch may not exist
	}
}
