import {existsSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {git, run} from './git.js';
import {
	JOB_RECORD_FILENAME,
	jobRecordPath,
	readJobRecord,
	removeJobRecord,
	type JobRecord,
} from './workspace.js';
import {workBranchRef} from './slug-namespace.js';

/**
 * The **reaper** for job worktrees, governed by the **provably-safe deletion
 * predicate** (ADR §4 in `docs/adr/execution-substrate-decisions.md`, the
 * authoritative source). Split out of `agent-workspaces` so the substrate stays
 * thin; this module owns deletion.
 *
 * A job's worktree is removed (auto, at end-of-job; or by `gc`) **iff**:
 *
 *   1. its working tree is **clean** (no uncommitted changes), AND
 *   2. its branch tip is **reachable on the arbiter** — either merged into
 *      `<arbiter>/main` (`git merge-base --is-ancestor <tip> <arbiter>/main`),
 *      OR pushed as an up-to-date branch (`<arbiter>/<branch>` tip == local tip).
 *
 * Both hold ⇒ the worktree is genuinely redundant (reconstructible from the
 * arbiter) ⇒ remove. Otherwise ⇒ **retain for the human** (a retained worktree
 * is a reliable "needs attention" signal that dovetails with `watch`'s
 * surface-failures rail).
 *
 * The trigger is **provable safety, not "success"**: a successful-but-unpushed
 * job is retained; a job whose commits are on the arbiter is reaped. One rule,
 * no done-vs-failed special-casing. Removal is always `git worktree remove`
 * (+ prune), NEVER a bare `rm -rf` (which would leave a dangling worktree
 * registration on the hub).
 *
 * `--force` overrides the predicate (discard un-saved work) — it must be loud
 * and explicit, NEVER the default.
 */

/** The arbiter remote name valid INSIDE a job worktree (ADR §2: cut from the
 * bare hub mirror whose clone remote is `origin`). */
const ARBITER_REMOTE = 'origin';

/**
 * Why a job's worktree was retained (not provably safe to remove). The reaper
 * surfaces exactly one of these per retained job (the FIRST failing clause, in
 * predicate order: dirty tree dominates, then arbiter-reachability).
 */
export type RetainReason =
	| 'dirty-tree' // uncommitted changes in the working tree
	| 'unmerged-commits' // clean, but the branch tip is NOT on the arbiter at all
	| 'branch-not-pushed'; // clean + a remote branch exists, but its tip != local tip

/** Human-readable text for each retain reason (used in `gc` reports). */
export const RETAIN_REASON_TEXT: Record<RetainReason, string> = {
	'dirty-tree': 'dirty tree (uncommitted changes)',
	'unmerged-commits': 'unmerged commits (branch tip not on the arbiter)',
	'branch-not-pushed': 'branch not pushed (remote tip differs from local tip)',
};

/** How a job's branch tip is reachable on the arbiter (when it is). */
export type ReachableVia = 'merged' | 'pushed';

/** The result of applying the deletion-safety predicate to one job worktree. */
export interface SafetyVerdict {
	/** True iff the worktree is provably safe to remove (clean AND reachable). */
	safe: boolean;
	/** When `safe`, HOW the tip is reachable on the arbiter. */
	reachableVia?: ReachableVia;
	/** When NOT `safe`, why it was retained. */
	reason?: RetainReason;
}

export interface EvaluateSafetyInput {
	/** The job worktree directory to evaluate. */
	dir: string;
	/** The work branch checked out there (`work/<slug>`). */
	branch: string;
	/**
	 * The arbiter remote name valid inside the worktree. Defaults to `origin`
	 * (the bare hub mirror's clone remote — ADR §2). Tests with a different
	 * layout can override it.
	 */
	arbiter?: string;
	env?: NodeJS.ProcessEnv;
}

/**
 * Apply the provably-safe deletion predicate (ADR §4) to ONE job worktree:
 *
 *   1. the working tree must be **clean** (no uncommitted changes), AND
 *   2. the branch tip must be **reachable on the arbiter** — merged
 *      (`merge-base --is-ancestor <tip> <arbiter>/main`) OR pushed
 *      (`<arbiter>/<branch>` tip == local tip).
 *
 * Reaches out to the arbiter (a `git fetch`) so the remote-tracking refs reflect
 * the live arbiter before checking reachability. Never mutates the worktree.
 * Pure verdict — the caller decides whether to reap.
 */
export function evaluateDeletionSafety(
	input: EvaluateSafetyInput,
): SafetyVerdict {
	const env = input.env;
	const arbiter = input.arbiter ?? ARBITER_REMOTE;

	// 1. Clean tree? Dirty dominates (we never reap over uncommitted work).
	if (!isWorkingTreeClean(input.dir, env)) {
		return {safe: false, reason: 'dirty-tree'};
	}

	// Refresh the arbiter's refs so reachability is checked against the LIVE
	// arbiter (not a stale local mirror). A job worktree is cut from a bare hub
	// mirror whose `origin` remote has NO fetch refspec (so `origin/main` /
	// `origin/<branch>` would not otherwise resolve) — so we fetch the two refs
	// we need EXPLICITLY into remote-tracking refs (the same technique
	// `integrator.rebaseOntoArbiterMain` uses). A plain `git fetch origin` would
	// instead try to clobber the checked-out branch on a mirror. Best-effort: an
	// unreachable arbiter leaves the local refs in place and the predicate reads
	// as not-reachable → retain (the safe direction).
	fetchTracking(input.dir, arbiter, 'main', env);
	fetchTracking(input.dir, arbiter, input.branch, env);

	const localTip = revParse(input.dir, 'HEAD', env);

	// 2a. Merged: the tip is an ancestor of <arbiter>/main.
	if (isAncestor(input.dir, localTip, `refs/remotes/${arbiter}/main`, env)) {
		return {safe: true, reachableVia: 'merged'};
	}

	// 2b. Pushed: <arbiter>/<branch> exists AND its tip == the local tip.
	const remoteTip = revParseOrUndefined(
		input.dir,
		`refs/remotes/${arbiter}/${input.branch}`,
		env,
	);
	if (remoteTip !== undefined && remoteTip === localTip) {
		return {safe: true, reachableVia: 'pushed'};
	}

	// Clean, but NOT on the arbiter: distinguish "a remote branch exists but its
	// tip differs (un-pushed amend)" from "no remote presence at all".
	if (remoteTip !== undefined) {
		return {safe: false, reason: 'branch-not-pushed'};
	}
	return {safe: false, reason: 'unmerged-commits'};
}

export interface ReapInput extends EvaluateSafetyInput {
	/**
	 * The bare hub mirror the worktree was cut from. `git worktree remove` +
	 * `prune` are run there (the worktree's registration lives on the mirror).
	 */
	mirrorPath: string;
	/**
	 * Override the predicate: remove the worktree even when NOT provably safe
	 * (discard un-saved work). Loud + explicit — NEVER the default (ADR §4).
	 */
	force?: boolean;
}

export interface ReapResult {
	/** True iff the worktree was actually removed. */
	removed: boolean;
	/** The verdict the decision was based on. */
	verdict: SafetyVerdict;
	/** True iff removal happened only because `force` overrode the predicate. */
	forced: boolean;
}

/**
 * Auto-reap ONE job worktree iff the predicate holds (or `force` overrides):
 * `git worktree remove` then `git worktree prune` on the hub mirror — NEVER a
 * bare `rm -rf` (ADR §4). Returns whether it removed the worktree + the verdict
 * it acted on (so the caller can report a retained job's reason).
 *
 * Used at end-of-job (the runner calls it after integrating) and by `gc` (the
 * catch-up when auto-reap didn't run). A job whose work is NOT on the arbiter is
 * never removed here (force is the only override, and it is explicit).
 */
export function reapJob(input: ReapInput): ReapResult {
	const verdict = evaluateDeletionSafety(input);
	const force = input.force === true;
	if (!verdict.safe && !force) {
		return {removed: false, verdict, forced: false};
	}
	removeWorktree(input.mirrorPath, input.dir, input.branch, input.env);
	return {removed: true, verdict, forced: !verdict.safe};
}

/** One job the `gc` sweep evaluated. */
export interface GcJob {
	/** Absolute path to the job worktree. */
	dir: string;
	/** The work slug (from the record, else derived from the dir name). */
	slug: string;
	/** The work branch (`work/<slug>`). */
	branch: string;
	/** The per-job record, when present. */
	record?: JobRecord;
}

/** A worktree `gc` reaped (provably safe, or forced). */
export interface ReapedJob extends GcJob {
	verdict: SafetyVerdict;
	/** True iff removed only because `--force` overrode the predicate. */
	forced: boolean;
}

/** A worktree `gc` retained, with the human-readable reason it kept it. */
export interface RetainedJob extends GcJob {
	reason: RetainReason;
	/** Human-readable reason text (`RETAIN_REASON_TEXT[reason]`). */
	reasonText: string;
}

export interface GcOptions {
	/** The execution working area (config `workspacesDir`, default `~/.agent-runner`). */
	workspacesDir: string;
	/**
	 * Override the predicate for EVERY job: discard un-saved work. Loud +
	 * explicit (the CLI guards it behind a confirmation) — NEVER the default.
	 */
	force?: boolean;
	/** Sink for human-readable progress notes (per reaped / retained job). */
	note?: (message: string) => void;
	env?: NodeJS.ProcessEnv;
}

export interface GcResult {
	/** The worktrees reaped this sweep (provably safe, or forced). */
	reaped: ReapedJob[];
	/** The worktrees retained, each with a clear reason. */
	retained: RetainedJob[];
}

/**
 * Re-apply the deletion-safety predicate across every `<workspacesDir>/work/*`
 * job (ADR §4): reap the provably-safe ones, RETAIN the rest and report each
 * with a clear reason. This is the safety-net catch-up for when auto-reap didn't
 * run (a runner crash/kill left the worktree behind).
 *
 * `force: true` overrides the predicate for every job (discard un-saved work) —
 * loud + explicit (the CLI confirms first), NEVER the default. A job whose work
 * is NOT on the arbiter is never auto-removed without `force`.
 */
export function gc(options: GcOptions): GcResult {
	const note = options.note ?? (() => {});
	const env = options.env;
	const reaped: ReapedJob[] = [];
	const retained: RetainedJob[] = [];

	for (const job of discoverJobs(options.workspacesDir)) {
		const mirrorPath = resolveMirrorPath(options.workspacesDir, job);
		const result = reapJob({
			dir: job.dir,
			branch: job.branch,
			mirrorPath,
			force: options.force,
			env,
		});

		if (result.removed) {
			reaped.push({...job, verdict: result.verdict, forced: result.forced});
			note(
				result.forced
					? `Reaped ${job.slug} (FORCED — discarded un-saved work).`
					: `Reaped ${job.slug} (${result.verdict.reachableVia}).`,
			);
			continue;
		}

		const reason = result.verdict.reason ?? 'unmerged-commits';
		const reasonText = RETAIN_REASON_TEXT[reason];
		retained.push({...job, reason, reasonText});
		note(`Retained ${job.slug}: ${reasonText}.`);
	}

	return {reaped, retained};
}

/**
 * Discover every job worktree under `<workspacesDir>/work/*` (the flat layout —
 * ADR §2). The per-job record is a SIBLING of the worktree dir
 * (`<work-id>.json` next to `<work-id>/`, {@link jobRecordPath}) — OUTSIDE the
 * checked-out tree so it can never be swept into a commit — so a work-id dir is
 * a job iff its sibling record file exists (with a LEGACY fallback to an in-tree
 * record left by an old binary, via {@link readJobRecord}). The branch comes
 * from the record (falling back to `work/<derived-slug>`).
 */
export function discoverJobs(workspacesDir: string): GcJob[] {
	const workDir = join(workspacesDir, 'work');
	if (!existsSync(workDir)) {
		return [];
	}
	const jobs: GcJob[] = [];
	for (const entry of readdirSync(workDir)) {
		const dir = join(workDir, entry);
		let isDir: boolean;
		try {
			isDir = statSync(dir).isDirectory();
		} catch {
			continue;
		}
		if (!isDir) {
			continue; // skip the sibling `<work-id>.json` record files themselves
		}
		// A job iff a record exists — the sibling path first, then the legacy
		// in-tree path (an old-binary worktree). Mirrors `readJobRecord`'s order.
		if (
			!existsSync(jobRecordPath(dir)) &&
			!existsSync(join(dir, JOB_RECORD_FILENAME))
		) {
			continue; // not a job worktree (no record at either location)
		}
		const record = readJobRecord(dir);
		const slug = record?.slug ?? deriveSlug(entry);
		// The job record carries the (already-namespaced) branch — the SOURCE OF
		// TRUTH. Only when a record is missing/legacy do we synthesise a fallback;
		// the flat work-id dir name cannot recover the type, so default to the
		// overwhelmingly-common `slice` namespace (a recordless worktree is a rare
		// legacy/corrupt case).
		const branch = record?.branch ?? workBranchRef('slice', slug);
		jobs.push({dir, slug, branch, record});
	}
	return jobs;
}

/** Derive a slug from a flat work-id dir name (`host__org__repo__slug`). */
function deriveSlug(workId: string): string {
	const parts = workId.split('__');
	return parts[parts.length - 1] || workId;
}

/**
 * The hub mirror a job worktree was cut from. We do NOT reconstruct it from the
 * encoded repo key (the key may not round-trip the arbiter URL): a worktree's
 * `.git` file points at its mirror's `worktrees/<id>` admin dir, so we read the
 * mirror's common dir directly from the worktree (robust + layout-agnostic).
 */
function resolveMirrorPath(workspacesDir: string, job: GcJob): string {
	const common = run(
		'git',
		['rev-parse', '--path-format=absolute', '--git-common-dir'],
		job.dir,
	);
	const dir = common.stdout.trim();
	if (common.status === 0 && dir !== '') {
		return dir;
	}
	// Fallback: the repos hub under the workspaces dir (best-effort).
	return join(workspacesDir, 'repos');
}

/**
 * True iff the working tree has NO uncommitted WORK (tracked, staged, or
 * untracked). The agent's edits and any untracked artefacts count: untracked
 * work is still un-saved work.
 *
 * The `.agent-runner-job.json` exclusion below is now INERT: the per-job record
 * lives at a SIBLING path OUTSIDE the worktree, so it can no longer appear in
 * the worktree's `git status` at all. It used to be load-bearing (the record
 * was written INSIDE the worktree, so a perfectly-saved job would otherwise read
 * as "dirty" purely because the runner wrote its own state file there). It is
 * kept as a harmless no-op that still names the record for a hypothetical
 * old-binary worktree whose record is still in-tree (the read-fallback case);
 * removing it would only risk regressing that edge with no upside. The
 * `work/`-ledger exclusion is a SEPARATE concern and stays.
 */
function isWorkingTreeClean(
	dir: string,
	env: NodeJS.ProcessEnv | undefined,
): boolean {
	// `status --porcelain` prints one line per change; empty ⇒ clean. Includes
	// staged, unstaged, and untracked files.
	const res = run('git', ['status', '--porcelain'], dir, {env});
	if (res.status !== 0) {
		// Can't determine cleanliness ⇒ treat as dirty (the safe direction).
		return false;
	}
	const lines = res.stdout
		.split('\n')
		.map((l) => l.trimEnd())
		.filter((l) => l !== '');
	// Each porcelain line is `XY <path>` (path starts at column 3). Drop the
	// runner's own job-record line; any remaining change ⇒ genuinely dirty.
	const work = lines.filter((l) => l.slice(3).trim() !== JOB_RECORD_FILENAME);
	return work.length === 0;
}

/**
 * Fetch a single arbiter head into its remote-tracking ref EXPLICITLY
 * (`+refs/heads/<head>:refs/remotes/<arbiter>/<head>`). A bare hub mirror has no
 * fetch refspec, so this is the only way the remote-tracking ref exists; it is
 * also harmless on a normal clone. Best-effort: the arbiter may be unreachable
 * (offline) or the head may not exist there — either way the local ref simply
 * stays absent/stale and the predicate reads as not-reachable → retain.
 */
function fetchTracking(
	dir: string,
	arbiter: string,
	head: string,
	env: NodeJS.ProcessEnv | undefined,
): void {
	run(
		'git',
		[
			'fetch',
			'--quiet',
			arbiter,
			`+refs/heads/${head}:refs/remotes/${arbiter}/${head}`,
		],
		dir,
		{env},
	);
}

/**
 * True iff `ancestor` is an ancestor of (or equal to) `descendant`, both
 * resolved IN the local repo `dir` (`git merge-base --is-ancestor`). This is the
 * ONE provably-merged reachability predicate in the system: the worktree reaper
 * above uses it for `<tip> --is-ancestor <arbiter>/main`, and the remote
 * merged-branch sweep (`reap-branches.ts`) REUSES it (not a second predicate) to
 * decide a remote `work/<slug>` branch is provably merged before deleting it.
 * EXPORTED so that single source of truth is shared, never forked.
 */
export function isAncestor(
	dir: string,
	ancestor: string,
	descendant: string,
	env: NodeJS.ProcessEnv | undefined,
): boolean {
	const res = run(
		'git',
		['merge-base', '--is-ancestor', ancestor, descendant],
		dir,
		{env},
	);
	return res.status === 0;
}

/** Resolve a ref to its 40-hex sha (throws if it doesn't resolve). */
function revParse(
	dir: string,
	ref: string,
	env: NodeJS.ProcessEnv | undefined,
): string {
	return git(['rev-parse', '--verify', '--quiet', ref], dir, {env}).trim();
}

/** Resolve a ref to its sha, or `undefined` if it doesn't resolve. */
function revParseOrUndefined(
	dir: string,
	ref: string,
	env: NodeJS.ProcessEnv | undefined,
): string | undefined {
	const res = run('git', ['rev-parse', '--verify', '--quiet', ref], dir, {env});
	if (res.status !== 0) {
		return undefined;
	}
	const sha = res.stdout.trim();
	return sha === '' ? undefined : sha;
}

/**
 * Remove a job worktree the contract-safe way: `git worktree remove` then
 * `git worktree prune` on the hub mirror, plus dropping the now-orphaned work
 * branch AND the now-orphaned per-job record (a SIBLING of the worktree since
 * the relocation — it no longer goes away WITH the worktree dir, so we delete it
 * explicitly so a reaped job leaves no `<work-id>.json` litter). NEVER a bare
 * `rm -rf` of the WORKTREE (ADR §4): a raw delete leaves a dangling worktree
 * registration on the hub. Best-effort on prune/branch-drop/record (idempotent
 * re-runs of `gc` must not error on an already-clean hub).
 */
function removeWorktree(
	mirrorPath: string,
	dir: string,
	branch: string,
	env: NodeJS.ProcessEnv | undefined,
): void {
	git(['worktree', 'remove', '--force', dir], mirrorPath, {env});
	removeJobRecord(dir);
	try {
		git(['worktree', 'prune'], mirrorPath, {env});
	} catch {
		// best-effort
	}
	try {
		git(['branch', '-D', branch], mirrorPath, {env});
	} catch {
		// branch may already be gone
	}
}
