import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {basename, dirname, join} from 'node:path';
import {git} from './git.js';
import {
	encodeRepoKey,
	ensureMirror,
	type EnsureMirrorResult,
} from './repo-mirror.js';
import {
	branchAheadOfArbiter,
	rebaseContinuedBranchOntoMain,
	pushContinuedBranchWithStaleLeaseRetry,
} from './continue-branch.js';
import {type HarnessRecord} from './harness.js';
import {brand} from './brand.js';
import {workBranchRef, type SlugNamespace} from './slug-namespace.js';

/**
 * The workspace manager (ADR §2): one git worktree per **job** (a claimed work
 * item being processed), checked out OUTSIDE the bare hub mirror at
 * `<workspacesDir>/work/<work-id>/`, on branch `work/<slug>`, branched off the
 * hub's freshly-fetched `main`.
 *
 * This is the single isolation primitive (ADR §1: jobs-not-agents) — both the
 * autonomous `run-once` runner and (later) the human `work-on` build on it. It
 * consumes the **`repo-mirror`** hub primitive (it does NOT reimplement mirror
 * management or the repo→key encoding) and leaves a per-job state record (a
 * `<work-id>.json` SIBLING of the worktree, OUTSIDE the checked-out tree —
 * {@link jobRecordPath}) + the worktree on disk for `gc`/`status` to read (those
 * are SEPARATE tasks — this task only provides the state they evaluate).
 *
 * `<workspacesDir>` is STATE, not cache (ADR §3): it lives under a single
 * visible `~/.dorfl/`, never `~/.cache`.
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
	/**
	 * Why the job is stuck, when `state` is `needs-attention` (ADR §12). The
	 * runner records the reason it routed the job to needs-attention (a red gate,
	 * a rebase conflict, …) so `status` can surface it without re-deriving it.
	 * Absent for `running`/`done` jobs.
	 */
	reason?: string;
	/**
	 * The URL of the review request opened for this job (e.g. a GitHub PR), when
	 * `propose` mode + a real provider (ADR §6) opened one. Recorded so `status`
	 * can surface it. Absent for merge mode, the push-only `none`/degraded path,
	 * and jobs that have not integrated yet.
	 */
	prUrl?: string;
	/** The harness block: how this job is launched + its liveness pointer. */
	harness: HarnessRecord;
}

/**
 * A job's lifecycle state, persisted in its record. The reaper (`gc`) and
 * `status` read it together with the worktree's existence (ADR §4); this task
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
 * E.g. `git@github.com:wighawag/dorfl.git` + `feat`
 *   → `github-com__wighawag__dorfl__feat`.
 */
export function encodeWorkId(url: string, slug: string): string {
	const key = encodeRepoKey(url).split('/').join('__');
	return `${key}__${slug}`;
}

/**
 * The on-disk location of a job's worktree: `<workspacesDir>/work/<work-id>/`.
 * Flat, OUTSIDE the hub (`<workspacesDir>/repos/...`), under `workspacesDir`
 * (default `~/.dorfl`), never `~/.cache` (ADR §3).
 */
export function jobWorktreePath(
	workspacesDir: string,
	url: string,
	slug: string,
): string {
	return join(workspacesDir, 'work', encodeWorkId(url, slug));
}

/** Filename of the per-job record. Derived from the single brand identity
 * (`.{base}-job.json`) so a rename flips it in lockstep.
 *
 * HISTORICAL: this used to be the name of a file written INSIDE the job worktree
 * (`<work-id>/.dorfl-job.json`). That in-tree location was the mistake —
 * a runtime control file inside the checked-out worktree got swept onto the work
 * branch by the runner's broad `git add -A` commits (and once WEDGED a
 * continue-rebase `git switch`). The record now lives at a SIBLING path OUTSIDE
 * the worktree ({@link jobRecordPath}); this constant survives only as the
 * legacy in-tree read-fallback name + as the no-op-build / clean-worktree
 * classification token in `agent-stop.ts`/`gc.ts` (now inert — the record can no
 * longer appear in `git status`). */
export const JOB_RECORD_FILENAME = brand.jobRecordFilename;

/**
 * The on-disk location of a job's state record: a SIBLING of its worktree dir,
 * `<workspacesDir>/work/<work-id>.json` (NEXT TO `<workspacesDir>/work/<work-id>/`,
 * NOT inside it).
 *
 * This is the structural fix for the in-tree leak: the record is still under the
 * same `workspacesDir/work/` control area (so `discoverJobs`'s single-directory
 * walk still finds it), but it is PHYSICALLY OUTSIDE the checked-out git
 * worktree, so the runner's broad `git add -A` commits can NEVER stage it — in
 * ANY repo, with no `.gitignore` entry needed. A `<work-id>.json` file name can
 * never collide with the `<work-id>/` worktree DIR (one carries a `.json`
 * extension, the other does not).
 *
 * Derived purely from the worktree `dir` (sibling = `<dir>.json`) so every
 * existing caller that holds a worktree dir keeps the same `(dir, …)` signature.
 */
export function jobRecordPath(dir: string): string {
	return join(dirname(dir), `${basename(dir)}.json`);
}

/** The LEGACY in-tree record path (`<dir>/.dorfl-job.json`) for the
 * read-fallback below — a job worktree materialised by an OLD binary still has
 * its record here. */
function legacyJobRecordPath(dir: string): string {
	return join(dir, JOB_RECORD_FILENAME);
}

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
	/** The work slug being processed (→ branch `work/<type>-<slug>` + work-id). */
	slug: string;
	/**
	 * The item TYPE — `'task'` (build) or `'prd'` (tasking) — namespacing the
	 * work branch via {@link workBranchRef} so a same-slug task and prd never
	 * collide. Defaults to `'task'`.
	 */
	type?: SlugNamespace;
	/** The execution working area (config `workspacesDir`, default `~/.dorfl`). */
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
	 * True iff this job CONTINUED a kept arbiter `work/<slug>` branch (a requeue)
	 * rather than cutting fresh off main — the worktree was cut from that branch
	 * and rebased onto the freshly-fetched main at onboard-time (ADR §10).
	 */
	continued: boolean;
	/**
	 * True iff a CONTINUE rebase onto fresh main CONFLICTED (aborted, never
	 * auto-resolved). The caller (`run`'s pipeline / `do --remote`) routes the
	 * item to needs-attention via the §10 path; the worktree is left on the
	 * un-rebased kept branch as the never-lose-work signal.
	 */
	continueRebaseConflict: boolean;
	/**
	 * Set iff the CONTINUE reconcile push to the arbiter FAILED TERMINALLY (the
	 * stale-lease retry cap was exhausted, or a non-stale-lease rejection such as
	 * a protected ref / an unreachable arbiter) — the helper THROWS, and we catch
	 * it here so the run does NOT crash leaving the task silently in-progress on
	 * the arbiter (the stale-lease-strand bug). The caller routes the item to
	 * needs-attention, the kept work left committed + recoverable on the branch.
	 * Absent on a fresh cut, a clean continue that pushed, and a rebase conflict
	 * (which sets {@link continueRebaseConflict} instead).
	 */
	continuePushFailure?: string;
	/**
	 * Remove the job's worktree + work branch from the hub (`git worktree remove`
	 * + prune; never a bare `rm -rf`, ADR §4). NOTE: the SAFE-to-delete predicate
	 * (ADR §4) is owned by the `gc` task — this is only the mechanical teardown
	 * the runner uses after a job is provably saved.
	 */
	dispose(): void;
}

const DEFAULT_HARNESS: HarnessRecord = {adapter: 'null'};

/**
 * Create (or recreate) a job: ensure the hub mirror via `repo-mirror`, then
 * `git worktree add` a per-job worktree OUTSIDE the hub at
 * `<workspacesDir>/work/<work-id>/` on `work/<slug>`, branched off the
 * freshly-fetched `<hub>/main`. Writes the per-job record at a SIBLING of the
 * worktree (`<work-id>.json`, OUTSIDE the tree — {@link jobRecordPath}).
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
	const branch = workBranchRef(options.type ?? 'task', slug);
	const dir = jobWorktreePath(options.workspacesDir, mirror.url, slug);

	// CONTINUE-detection (shared with the in-place path, ADR §14 keystone): after
	// `ensureMirror`'s mirror-style fetch (`+refs/heads/*:refs/heads/*`), a kept
	// arbiter `work/<slug>` lands as a LOCAL head `work/<slug>` in the bare mirror.
	// If it is AHEAD of `main` (a requeue kept it), CONTINUE from it; otherwise cut
	// FRESH off main (the common case — a first attempt, or `requeue --reset` deleted
	// it).
	// ARBITER-AUTHORITATIVE continue-detection: `ls-remote` the arbiter (the
	// mirror's `origin`) so an orphaned local head/tracking-ref in the bare hub
	// mirror — e.g. a `refs/remotes/origin/work/<slug>` in the namespace no
	// `remote.origin.fetch` refspec prunes, or a `refs/heads/work/<slug>` that
	// `ensureMirror`'s `--prune` could not reach — cannot resurrect a branch the
	// arbiter no longer has (e.g. a cross-machine `gc --remote-branches` delete).
	const continueFromKept = branchAheadOfArbiter({
		cwd: mirror.path,
		arbiterRemote: 'origin',
		branch,
		branchRef: branch,
		mainRef: 'main',
		env,
	});
	let continued = false;
	let continueRebaseConflict = false;
	let continuePushFailure: string | undefined;

	if (continueFromKept) {
		// The arbiter `work/<slug>` tip the mirror fetched, READ BEFORE the onboard
		// rebase rewrites the local branch — the value the --force-with-lease push
		// expects the arbiter to still hold. A requeue-continue can CHURN this ref
		// after the mirror fetch, making the lease stale; the retry below re-leases
		// against the freshly-fetched tip (the WORK branch is unshared, so re-observing
		// + replaying is correct).
		const expectedRemoteTip = git(['rev-parse', branch], mirror.path, {
			env,
		}).trim();

		// Clear ONLY a stale worktree DIR (never the branch we are continuing), then
		// cut the worktree FROM the kept branch (not fresh off main).
		clearStaleWorktreeOnly(mirror.path, dir, env);
		git(['worktree', 'add', dir, branch], mirror.path, {env});
		continued = true;

		// REBASE the continued branch onto the freshly-fetched mirror main at
		// onboard-time (ADR §10: rebase, not merge) so the agent builds on a CURRENT
		// base. A CLEAN rebase → update the already-pushed arbiter tip with
		// --force-with-lease on the WORK branch ONLY (a requeued item is unshared) —
		// NEVER --force, NEVER to main (§11). A CONFLICT → aborted (never
		// auto-resolved) + flagged so the caller routes to needs-attention.
		const rebase = rebaseContinuedBranchOntoMain(dir, 'main', env);
		if (rebase.kind === 'conflict') {
			continueRebaseConflict = true;
		} else {
			// Push the rebased tip with --force-with-lease, SURVIVING a stale-lease
			// ("stale info") rejection: re-fetch the arbiter `work/<slug>` + main,
			// re-rebase onto current main, and retry (bounded) instead of stranding the
			// committed green work in the worktree. A rebase CONFLICT on a retry is the
			// SAME abort → needs-attention path (never auto-resolved).
			//
			// The helper THROWS on a terminal failure (the stale-lease retry cap, or a
			// non-stale-lease rejection / unreachable arbiter). BEFORE this task that
			// throw ESCAPED `createJob` uncaught, crashing the run and leaving the
			// already-committed kept work silently in `work/in-progress/` on the arbiter
			// (the stale-lease-strand incident). We now CATCH it and flag
			// `continuePushFailure` so the caller (`runRemotePipeline`) routes the item
			// to needs-attention — the kept work stays committed + recoverable on the
			// branch — instead of stranding it.
			try {
				const pushed = pushContinuedBranchWithStaleLeaseRetry({
					cwd: dir,
					branch,
					arbiter: 'origin',
					mainRef: 'main',
					expectedRemoteTip,
					env,
				});
				if (pushed.kind === 'conflict') {
					continueRebaseConflict = true;
				}
			} catch (err) {
				continuePushFailure = err instanceof Error ? err.message : String(err);
			}
		}
	} else {
		// Clear any stale registration for this work-id (idempotent re-create): a
		// leftover worktree dir or branch from a prior crashed run would block the
		// `worktree add`. We use git's own removal, never a bare rm -rf (ADR §4).
		clearStale(mirror.path, dir, branch, env);

		// Cut the worktree OUTSIDE the hub, on a fresh per-slug branch off the
		// freshly-fetched mirror main. `--force` is not used: the branch is unique.
		git(['worktree', 'add', '-b', branch, dir, 'main'], mirror.path, {env});
	}

	const record: JobRecord = {
		slug,
		repoKey: encodeRepoKey(mirror.url),
		branch,
		startedAt: new Date().toISOString(),
		state: 'running',
		harness: options.harness ?? DEFAULT_HARNESS,
	};
	const recordPath = jobRecordPath(dir);
	writeJobRecord(dir, record);

	return {
		dir,
		branch,
		slug,
		arbiterRemote: 'origin',
		recordPath,
		record,
		mirror,
		continued,
		continueRebaseConflict,
		continuePushFailure,
		dispose() {
			git(['worktree', 'remove', '--force', dir], mirror.path, {env});
			removeJobRecord(dir);
			pruneAndDropBranch(mirror.path, branch, env);
		},
	};
}

/**
 * Write (or overwrite) a job's record to its SIBLING path ({@link jobRecordPath},
 * `<work-id>.json` next to the worktree), OUTSIDE the checked-out tree. `dir` is
 * the worktree dir, kept as the parameter so every caller is unchanged.
 */
export function writeJobRecord(dir: string, record: JobRecord): void {
	writeFileSync(jobRecordPath(dir), JSON.stringify(record, null, 2) + '\n');
}

/**
 * Read a job's record given its worktree `dir`, or `undefined` if absent/invalid.
 *
 * Reads the NEW sibling location ({@link jobRecordPath}) first, then falls back
 * to the LEGACY in-tree location (`<dir>/.dorfl-job.json`) so a job
 * worktree materialised by an OLD binary (record still inside the tree) stays
 * discoverable/reapable until it is torn down. New jobs only ever write the
 * sibling path, so the fallback is purely for in-flight migration.
 */
export function readJobRecord(dir: string): JobRecord | undefined {
	for (const path of [jobRecordPath(dir), legacyJobRecordPath(dir)]) {
		if (!existsSync(path)) {
			continue;
		}
		try {
			return JSON.parse(readFileSync(path, 'utf8')) as JobRecord;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/**
 * Delete a job's record on teardown — BOTH the new sibling path
 * ({@link jobRecordPath}) and the legacy in-tree path (an old-binary worktree).
 * Best-effort + idempotent (a missing file is fine). Called when a worktree is
 * removed (reaped / disposed / cleared) so the relocated record does not outlive
 * its worktree as an orphan `<work-id>.json` (when the record lived INSIDE the
 * worktree it was deleted WITH it by `git worktree remove`; now that it is a
 * sibling, its teardown must be explicit).
 */
export function removeJobRecord(dir: string): void {
	for (const path of [jobRecordPath(dir), legacyJobRecordPath(dir)]) {
		try {
			rmSync(path, {force: true});
		} catch {
			// best-effort: an unremovable orphan record is harmless (discovery
			// keys on the worktree DIR, which is gone).
		}
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

/**
 * Clear ONLY a stale worktree DIR (and prune dangling registrations) — WITHOUT
 * dropping the branch. Used on the CONTINUE path so the kept `work/<slug>`
 * branch (the durable requeue artifact) is NEVER nuked while a leftover worktree
 * dir from a prior crashed attempt is still cleared so `worktree add` succeeds.
 */
function clearStaleWorktreeOnly(
	mirrorPath: string,
	dir: string,
	env: NodeJS.ProcessEnv | undefined,
): void {
	if (existsSync(dir)) {
		try {
			git(['worktree', 'remove', '--force', dir], mirrorPath, {env});
		} catch {
			// fall through to prune below
		}
	}
	try {
		git(['worktree', 'prune'], mirrorPath, {env});
	} catch {
		// best-effort
	}
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
