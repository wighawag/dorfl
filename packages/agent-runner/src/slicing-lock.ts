import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {runAsync, type RunResult} from './git.js';
import {ledgerWrite} from './ledger-write.js';
import {setSlicedMarker} from './frontmatter.js';

/**
 * The **slicing concurrency lock** (PRD `auto-slice`, slice `autoslice-lock`).
 *
 * Serialises *concurrent* slicers (two CI runs, or human + CI) so a PRD is never
 * double-sliced — reusing the proven claim compare-and-swap, NOT a new lock
 * mechanism. It is the same shape as the build-claim (`claim-cas.ts`): a
 * `git mv` micro-commit raced to the arbiter's `main` via the ledger-transition
 * write seam's CAS (`applyTransition`).
 *
 * - **Acquire** ({@link acquireSlicingLock}) atomically races a
 *   `git mv work/prd/<slug>.md → work/slicing/<slug>.md` micro-commit through the
 *   seam (transition kind `slicing`), on the branch `slicing/<slug>` — DISTINCT
 *   from the build-claim's `claim/<slug>` and the work branch `work/<slug>`, so a
 *   slicing lock can never collide with a build claim of the same slug. The
 *   winner HOLDS the lock (the PRD now lives at `work/slicing/<slug>.md`); a loser
 *   gets the CAS's exit-2 ('lost') and backs off.
 *
 * - **Release** ({@link releaseSlicingLock}) moves the PRD back
 *   `work/slicing/<slug>.md → work/prd/<slug>.md` against the CURRENT arbiter
 *   `main` — NOT a force-restore (the restore is a normal commit on the latest
 *   `main`, CAS-leased so it can only fast-forward, NEVER `--force`). This is the
 *   read-stability backstop
 *   (`work/observations/slicing-lock-does-not-stabilise-prd-content.md`): the lock
 *   serialises the ACT of slicing, but a human/agent can still EDIT the held PRD
 *   body while a slice is in flight. Before restoring, release compares the
 *   CURRENTLY held `work/slicing/<slug>.md` body on the arbiter against the
 *   snapshot the lock TOOK (the `lockedBlob` acquire returned). If they DIFFER, a
 *   concurrent edit landed under the lock → the slicing is STALE → release FAILS
 *   LOUD (outcome `stale`), touching NOTHING, so the caller re-slices or routes
 *   the PRD to `work/needs-attention/`. It NEVER silently overwrites the edit or
 *   lets stale slices land.
 *
 *   This is a CONTENT-IDENTITY check, deliberately stronger than "rebase the
 *   restore and see if it conflicts": git's rename+edit merge would apply a
 *   slicing-body edit CLEANLY onto a rebased restore, silently carrying the edit
 *   into `prd/` while the already-emitted slices were cut from the OLD body —
 *   exactly the SILENT stale-slice drift the backstop exists to prevent. So
 *   "rebase against main, fail loud on a concurrent edit" is realized as "restore
 *   onto current `main` + content-identity stale check + leased (never-force) CAS
 *   push," which detects the edit a textual rebase conflict would miss.
 *
 * `work/slicing/` is a TRANSIENT HELD LOCK, never a resting/post-slice state:
 * after a successful slice the PRD is back in `work/prd/` and `work/slicing/` is
 * empty. Sliced-ness is recorded by the PRD's `sliced:` frontmatter marker, never
 * by residence in `work/slicing/`.
 *
 * This module provides the lock + release PRIMITIVES only. The orchestrating
 * `do prd:<slug>` slicing command — which acquires, drives the agent's slicing,
 * commits the emitted backlog slices, and releases — is a LATER slice. The human
 * path (no contention) may slice on `main` directly without taking the lock; the
 * command wires that human-vs-agent choice. Nothing here makes the lock mandatory
 * for a no-contention human.
 */

const DEFAULT_ARBITER = 'origin';

/** A semantic label for the lock-acquire outcome (never the verdict itself). */
export type AcquireSlicingLockOutcome =
	| 'acquired'
	| 'usage-error'
	| 'lost'
	| 'contended';

/** Maps onto the claim-CAS exit codes (identical semantics). */
export type AcquireSlicingLockExitCode = 0 | 1 | 2 | 3;

export interface AcquireSlicingLockOptions {
	/** The PRD slug to lock (`work/prd/<slug>.md`). */
	slug: string;
	/** Working clone/worktree the lock acquire runs in. */
	cwd: string;
	/** Name of the arbiter remote (`--arbiter`). Defaults to `origin`. */
	arbiter?: string;
	/** Advisory locker id. Defaults to git user.name, then $USER. */
	by?: string;
	/** Cap on push retries when main merely advanced. Default 3. */
	retries?: number;
	/** Show the intended push without mutating the arbiter (`--dry-run`). */
	dryRun?: boolean;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface AcquireSlicingLockResult {
	exitCode: AcquireSlicingLockExitCode;
	outcome: AcquireSlicingLockOutcome;
	/** Human-readable summary of the terminal condition. */
	message: string;
	/**
	 * On a successful acquire (`acquired`), the git BLOB sha of the PRD body that
	 * the lock TOOK (`work/slicing/<slug>.md` as published). This IS the snapshot
	 * the slicer reads + slices from; the caller hands it back to
	 * {@link releaseSlicingLock} as `lockedBlob` so the release can fail loud if the
	 * held PRD was edited concurrently (the read-stability backstop). `undefined`
	 * unless `outcome === 'acquired'` (and on dry-run, where nothing was published).
	 */
	lockedBlob?: string;
}

/** Raised for usage/environment errors (exit 1). */
class SlicingLockUsageError extends Error {}

/** Internal: the result of a single acquire attempt. */
type AcquireAttemptResult =
	| {kind: 'acquired'; message: string; lockedBlob?: string}
	| {kind: 'lost'; message: string}
	| {kind: 'rejected'; message: string};

/**
 * Acquire the slicing lock for `slug`: race a `prd → slicing/` micro-commit to
 * the arbiter via the seam CAS. Never throws for the expected "lost the race"
 * (exit 2) or "contended" (exit 3) cases — those are returned. Usage/environment
 * problems surface as exit 1; a held lock is exit 0. Mirrors `performClaim`'s
 * control flow exactly (it IS the same CAS, on a different folder pair + branch).
 */
export async function acquireSlicingLock(
	options: AcquireSlicingLockOptions,
): Promise<AcquireSlicingLockResult> {
	const note = options.note ?? (() => {});
	try {
		return await runAcquire(options, note);
	} catch (err) {
		if (err instanceof SlicingLockUsageError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}
}

async function runAcquire(
	options: AcquireSlicingLockOptions,
	note: (m: string) => void,
): Promise<AcquireSlicingLockResult> {
	const slug = options.slug;
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const retries = options.retries ?? 3;
	const dryRun = options.dryRun ?? false;
	const cwd = options.cwd;
	const env = options.env;

	if (!slug) {
		throw new SlicingLockUsageError(
			'missing <slug>. usage: acquireSlicingLock({slug, cwd, arbiter})',
		);
	}
	if ((await gitSoft(['rev-parse', '--git-dir'], cwd, env)).status !== 0) {
		throw new SlicingLockUsageError('not inside a git repository');
	}
	if ((await gitSoft(['remote', 'get-url', arbiter], cwd, env)).status !== 0) {
		throw new SlicingLockUsageError(
			`no git remote named '${arbiter}' (set one, or pass --arbiter)`,
		);
	}
	const by = options.by || (await resolveBy(cwd, env));

	// Refuse to run with a dirty tree — the lock must be a clean, isolated commit.
	const dirtyWorktree =
		(await gitSoft(['diff', '--quiet'], cwd, env)).status !== 0;
	const dirtyIndex =
		(await gitSoft(['diff', '--cached', '--quiet'], cwd, env)).status !== 0;
	if (dirtyWorktree || dirtyIndex) {
		throw new SlicingLockUsageError(
			'working tree has uncommitted changes; commit/stash them before locking',
		);
	}

	const prd = `work/prd/${slug}.md`;
	const slicing = `work/slicing/${slug}.md`;
	// DISTINCT from the build-claim's `claim/<slug>` and the work branch
	// `work/<slug>` — a slicing lock can never collide with a build claim.
	const lockBranch = `slicing/${slug}`;

	const origRef = await originalRef(cwd, env);
	try {
		let i = 0;
		// eslint-disable-next-line no-constant-condition
		while (true) {
			const result = await acquireAttempt({
				slug,
				arbiter,
				by,
				dryRun,
				cwd,
				env,
				prd,
				slicing,
				lockBranch,
				note,
			});
			if (result.kind === 'acquired') {
				return {
					exitCode: 0,
					outcome: 'acquired',
					message: result.message,
					lockedBlob: result.lockedBlob,
				};
			}
			if (result.kind === 'lost') {
				return {exitCode: 2, outcome: 'lost', message: result.message};
			}
			// rejected: main moved under us — retry up to the cap, then back off.
			i += 1;
			if (i > retries) {
				const message = `push rejected ${i} times (main is contended). Try again shortly.`;
				note(message);
				return {exitCode: 3, outcome: 'contended', message};
			}
			note(`main advanced under us — refetch and retry (${i}/${retries})...`);
		}
	} finally {
		await cleanup(cwd, origRef, lockBranch, env);
	}
}

interface AcquireAttemptContext {
	slug: string;
	arbiter: string;
	by: string;
	dryRun: boolean;
	cwd: string;
	env: NodeJS.ProcessEnv | undefined;
	prd: string;
	slicing: string;
	lockBranch: string;
	note: (m: string) => void;
}

/** One acquire attempt: branch off arbiter/main, mv prd→slicing, CAS-push. */
async function acquireAttempt(
	ctx: AcquireAttemptContext,
): Promise<AcquireAttemptResult> {
	const {arbiter, slug, prd, slicing, lockBranch, cwd, env, note} = ctx;

	await gitHard(['fetch', '--quiet', arbiter], cwd, env);

	// Is the PRD still lockable (in work/prd/) on the arbiter's main?
	if (!(await catFileExists(`${arbiter}/main:${prd}`, cwd, env))) {
		if (await catFileExists(`${arbiter}/main:${slicing}`, cwd, env)) {
			const message = `'${slug}' is already being sliced (lock held) on ${arbiter}/main — someone holds the slicing lock. Back off.`;
			note(message);
			return {kind: 'lost', message};
		}
		const message = `'${prd}' not found on ${arbiter}/main (no such PRD, or it was already moved).`;
		note(message);
		return {kind: 'lost', message};
	}

	// Fresh lock branch off the latest arbiter main.
	await gitSoft(['branch', '-D', lockBranch], cwd, env);
	await gitHard(
		['checkout', '--quiet', '-b', lockBranch, `${arbiter}/main`],
		cwd,
		env,
	);

	// Make the destination dir exist, then move. A failed move must abort (fatal),
	// never silently continue — guarding against a false "acquired".
	const slicingAbs = join(cwd, slicing);
	mkdirSync(dirname(slicingAbs), {recursive: true});
	const mv = await gitSoft(['mv', prd, slicing], cwd, env);
	if (mv.status !== 0) {
		throw new SlicingLockUsageError(
			`git mv failed for '${prd}' (unexpected — aborting lock)`,
		);
	}

	await gitHard(
		['commit', '--quiet', '-m', `slicing: lock ${slug} (by ${ctx.by})`],
		cwd,
		env,
	);

	// Sanity: the lock commit MUST be a real child of the arbiter main we branched
	// from (it actually moved something) — guarding against a no-op that would make
	// an "Everything up-to-date" push look like a successful lock.
	const base = (
		await gitHard(['rev-parse', `${arbiter}/main`], cwd, env)
	).stdout.trim();
	const head = (await gitHard(['rev-parse', 'HEAD'], cwd, env)).stdout.trim();
	if (head === base) {
		throw new SlicingLockUsageError(
			'slicing-lock commit is a no-op (nothing moved) — aborting',
		);
	}
	const parent = (
		await gitHard(['rev-parse', 'HEAD^'], cwd, env)
	).stdout.trim();
	if (parent !== base) {
		throw new SlicingLockUsageError(
			`slicing-lock is not a direct child of ${arbiter}/main — aborting`,
		);
	}

	// Publish the prepared lock micro-commit THROUGH the write seam (kind
	// `slicing`) — the same CAS the claim uses; the `:main` push + lease + verify
	// all live inside the strategy, NOT here (no raw claim-cas / direct main push).
	if (ctx.dryRun) {
		const result = await ledgerWrite.applyTransition({
			kind: 'slicing',
			arbiter,
			localBranch: lockBranch,
			expectedBase: base,
			head,
			cwd,
			dryRun: true,
			env,
			note,
		});
		return {kind: 'acquired', message: result.message};
	}

	const result = await ledgerWrite.applyTransition({
		kind: 'slicing',
		arbiter,
		localBranch: lockBranch,
		expectedBase: base,
		head,
		cwd,
		env,
		note,
	});
	if (result.kind === 'published') {
		const message = `LOCKED '${slug}' for slicing -> work/slicing/ on ${arbiter}/main.`;
		note(message);
		// The blob the lock TOOK = the slicing/<slug>.md body just published. It is
		// the snapshot the slicer reads; release compares the held body against it.
		const lockedBlob = (
			await gitHard(['rev-parse', `${head}:${slicing}`], cwd, env)
		).stdout.trim();
		return {kind: 'acquired', message, lockedBlob};
	}
	return {kind: 'rejected', message: result.message};
}

// --- Release --------------------------------------------------------------

/** A semantic label for the lock-release outcome. */
export type ReleaseSlicingLockOutcome =
	| 'released'
	| 'usage-error'
	| 'lost'
	| 'contended'
	| 'stale';

/** Maps onto the claim-CAS exit codes, plus `4` for a STALE (conflicting) lock. */
export type ReleaseSlicingLockExitCode = 0 | 1 | 2 | 3 | 4;

export interface ReleaseSlicingLockOptions {
	/** The PRD slug whose lock to release (`work/slicing/<slug>.md`). */
	slug: string;
	/** Working clone/worktree the release runs in. */
	cwd: string;
	/** Name of the arbiter remote (`--arbiter`). Defaults to `origin`. */
	arbiter?: string;
	/**
	 * The git BLOB sha the lock TOOK ({@link AcquireSlicingLockResult.lockedBlob})
	 * — the snapshot the slicer read + sliced from. Release compares the CURRENTLY
	 * held `work/slicing/<slug>.md` body on the arbiter against this; if they
	 * differ, a concurrent writer edited the held PRD while the lock was held → the
	 * slicing is STALE → fail loud (outcome `stale`). This is the read-stability
	 * backstop: a CONTENT-IDENTITY check (compare the held blob to the locked
	 * snapshot), deliberately STRONGER than a textual rebase conflict (which can
	 * MISS a clean rename+edit merge — the silent-stale-slice case).
	 *
	 * REQUIRED in practice: when OMITTED the release REFUSES (outcome
	 * `usage-error`) rather than silently restoring `slicing/ → prd/` — because
	 * without the snapshot the stale check cannot run, and an unchecked restore
	 * would silently carry a concurrent edit into `prd/` (the exact
	 * never-silently-overwrite behaviour the lock forbids). The `do prd:` command
	 * (the lock's first live consumer) captures it at acquire-time and always
	 * passes it back here.
	 */
	lockedBlob?: string;
	/** Advisory releaser id. Defaults to git user.name, then $USER. */
	by?: string;
	/** Cap on push retries when main merely advanced. Default 3. */
	retries?: number;
	/**
	 * The COMPLETING slicing transition (the `do prd:` command, slice
	 * `autoslice-command`): the produced backlog slice files to drop INTO the same
	 * release commit, keyed by repo-relative path (e.g.
	 * `work/backlog/<slug>.md`) → file content. The runner commits these alongside
	 * the `slicing/ → prd/` restore so the emitted backlog, the lock release, and
	 * the `sliced:` marker are ONE runner-owned transition (never the agent's git).
	 * Omitted ⇒ a bare lock release (no slices emitted).
	 */
	emitSlices?: Record<string, string>;
	/**
	 * When set (the `do prd:` completing transition), stamp the restored PRD's
	 * frontmatter with `sliced: <markSliced>` (a `YYYY-MM-DD` date) in the SAME
	 * release commit — recording sliced-ness on the durable PRD marker, not on
	 * residence in `slicing/`. Omitted ⇒ the PRD frontmatter is restored unchanged.
	 */
	markSliced?: string;
	/**
	 * The slicer review→edit LOOP's **decomposition-unclear** verdict
	 * (`slicer-review-edit-loop`): instead of restoring the held PRD
	 * `work/slicing/<slug>.md → work/prd/<slug>.md`, restore it to
	 * `work/needs-attention/<slug>.md` with this reason recorded as body prose (the
	 * open questions), emitting NO guessed slices. The lock is still released (the
	 * PRD leaves `work/slicing/`), but it lands in needs-attention rather than back
	 * in `work/prd/`, so it is NOT re-sliceable until a human resolves it. When set,
	 * `emitSlices`/`markSliced` are IGNORED (no slices land, the PRD is not marked
	 * sliced). Omitted ⇒ the normal `slicing/ → prd/` restore. The CONTENT-IDENTITY
	 * stale check still runs first (a concurrent edit under the lock is still `stale`).
	 */
	routeToNeedsAttention?: {reason: string};
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface ReleaseSlicingLockResult {
	exitCode: ReleaseSlicingLockExitCode;
	outcome: ReleaseSlicingLockOutcome;
	/** Human-readable summary of the terminal condition. */
	message: string;
}

/**
 * Release the slicing lock for `slug`: move the PRD back
 * `work/slicing/<slug>.md → work/prd/<slug>.md` against the CURRENT arbiter
 * `main` (the restore is a normal commit on the latest `main`, CAS-leased so it
 * can only fast-forward) — never a force-restore.
 *
 * Before restoring, a CONTENT-IDENTITY STALE CHECK + a leased CAS restore (NOT a
 * textual rebase) decides released-vs-stale: it compares the CURRENTLY held
 * `work/slicing/<slug>.md` body on the arbiter against the snapshot the lock TOOK
 * ({@link ReleaseSlicingLockOptions.lockedBlob}). If a concurrent writer edited
 * the held PRD's body on the arbiter (the blob changed under the lock), the
 * slicing is STALE → we FAIL LOUD (outcome `stale`, exit 4) and the arbiter is
 * left UNTOUCHED (the lock stays held, the edit is preserved). The caller then
 * re-slices from the edited PRD or routes it to `work/needs-attention/`. We never
 * silently overwrite the edit or land stale slices. This is deliberately
 * STRONGER than "rebase the restore and see if it conflicts": git's rename+edit
 * merge would apply a slicing-body edit CLEANLY onto a rebased restore, silently
 * carrying it into `prd/` while the emitted slices were cut from the OLD body.
 *
 * When `lockedBlob` is OMITTED the release REFUSES (outcome `usage-error`)
 * instead of skipping the stale check and unconditionally restoring — an
 * unchecked restore would silently carry a concurrent edit into `prd/`, the exact
 * footgun the lock forbids. Pass the acquire-time `lockedBlob` (the `do prd:`
 * command always does).
 *
 * The COMPLETING `do prd:` transition (`emitSlices` / `markSliced`) folds the
 * produced backlog slices + the PRD's `sliced:` marker INTO the same release
 * commit, so the emitted backlog, the lock release, and the marker are ONE
 * runner-owned transition (the agent never does git).
 *
 * Outcomes:
 *   - `released` (0): the PRD is back in `work/prd/`, `work/slicing/` empty.
 *   - `usage-error` (1): bad input / environment (incl. an omitted `lockedBlob`).
 *   - `lost` (2): the lock is not held (no `work/slicing/<slug>.md` on main).
 *   - `contended` (3): the push kept failing (main churning) — try again.
 *   - `stale` (4): a concurrent edit landed; the slicing is stale — fail loud.
 */
export async function releaseSlicingLock(
	options: ReleaseSlicingLockOptions,
): Promise<ReleaseSlicingLockResult> {
	const note = options.note ?? (() => {});
	try {
		return await runRelease(options, note);
	} catch (err) {
		if (err instanceof SlicingLockUsageError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}
}

async function runRelease(
	options: ReleaseSlicingLockOptions,
	note: (m: string) => void,
): Promise<ReleaseSlicingLockResult> {
	const slug = options.slug;
	const lockedBlob = options.lockedBlob;
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const retries = options.retries ?? 3;
	const cwd = options.cwd;
	const env = options.env;

	if (!slug) {
		throw new SlicingLockUsageError(
			'missing <slug>. usage: releaseSlicingLock({slug, cwd, arbiter})',
		);
	}
	if ((await gitSoft(['rev-parse', '--git-dir'], cwd, env)).status !== 0) {
		throw new SlicingLockUsageError('not inside a git repository');
	}
	if ((await gitSoft(['remote', 'get-url', arbiter], cwd, env)).status !== 0) {
		throw new SlicingLockUsageError(
			`no git remote named '${arbiter}' (set one, or pass --arbiter)`,
		);
	}
	// REFUSE an omitted lockedBlob: without the snapshot the content-identity stale
	// check cannot run, and an unchecked restore would silently carry a concurrent
	// edit into prd/ — the never-silently-overwrite behaviour the lock forbids. The
	// `do prd:` command (the lock's first live consumer) always passes it.
	if (lockedBlob === undefined) {
		throw new SlicingLockUsageError(
			`refusing to release '${slug}' without the acquire-time lockedBlob: the ` +
				'content-identity stale check cannot run, and an unchecked restore could ' +
				'silently overwrite a concurrent edit. Pass the lockedBlob acquire ' +
				'returned.',
		);
	}

	const by = options.by || (await resolveBy(cwd, env));

	const dirtyWorktree =
		(await gitSoft(['diff', '--quiet'], cwd, env)).status !== 0;
	const dirtyIndex =
		(await gitSoft(['diff', '--cached', '--quiet'], cwd, env)).status !== 0;
	if (dirtyWorktree || dirtyIndex) {
		throw new SlicingLockUsageError(
			'working tree has uncommitted changes; commit/stash them before releasing',
		);
	}

	const prd = `work/prd/${slug}.md`;
	const slicing = `work/slicing/${slug}.md`;
	const releaseBranch = `slicing-release/${slug}`;

	const origRef = await originalRef(cwd, env);
	try {
		let i = 0;
		// eslint-disable-next-line no-constant-condition
		while (true) {
			const result = await releaseAttempt({
				slug,
				arbiter,
				by,
				cwd,
				env,
				prd,
				slicing,
				releaseBranch,
				lockedBlob,
				emitSlices: options.emitSlices,
				markSliced: options.markSliced,
				routeToNeedsAttention: options.routeToNeedsAttention,
				note,
			});
			if (result.kind === 'released') {
				return {exitCode: 0, outcome: 'released', message: result.message};
			}
			if (result.kind === 'lost') {
				return {exitCode: 2, outcome: 'lost', message: result.message};
			}
			if (result.kind === 'stale') {
				return {exitCode: 4, outcome: 'stale', message: result.message};
			}
			// rejected: main moved under us — refetch, re-attempt, and let the rebase
			// (against the NEW main) decide released-vs-stale. Cap at retries.
			i += 1;
			if (i > retries) {
				const message = `push rejected ${i} times (main is contended). Try again shortly.`;
				note(message);
				return {exitCode: 3, outcome: 'contended', message};
			}
			note(`main advanced under us — refetch and retry (${i}/${retries})...`);
		}
	} finally {
		await cleanup(cwd, origRef, releaseBranch, env);
	}
}

interface ReleaseAttemptContext {
	slug: string;
	arbiter: string;
	by: string;
	cwd: string;
	env: NodeJS.ProcessEnv | undefined;
	prd: string;
	slicing: string;
	releaseBranch: string;
	lockedBlob: string | undefined;
	emitSlices: Record<string, string> | undefined;
	markSliced: string | undefined;
	routeToNeedsAttention: {reason: string} | undefined;
	note: (m: string) => void;
}

type ReleaseAttemptResult =
	| {kind: 'released'; message: string}
	| {kind: 'lost'; message: string}
	| {kind: 'stale'; message: string}
	| {kind: 'rejected'; message: string};

/**
 * One release attempt. Branch off the arbiter `main` of the moment the lock was
 * TAKEN (the commit that moved `prd → slicing`), restore `slicing → prd` there,
 * then REBASE that restore onto the CURRENT `<arbiter>/main`.
 *
 * STALE DETECTION. Before rebasing, we compare the HELD PRD's content on the
 * current `<arbiter>/main` (`work/slicing/<slug>.md`) against the snapshot the
 * lock TOOK (the same path at the lock commit). If they differ AT ALL, a
 * concurrent writer edited the held PRD while the lock was held → the slicing is
 * STALE → fail loud, touch NOTHING on the arbiter. This is a content-identity
 * check, NOT merely a textual rebase conflict: git's rename+edit merge can apply
 * a slicing-body edit CLEANLY onto the restore, which would silently carry the
 * edit into `prd/` while the already-emitted slices were derived from the OLD
 * body — exactly the silent stale-slice drift the read-stability backstop must
 * prevent (`work/observations/slicing-lock-does-not-stabilise-prd-content.md`).
 * So we treat ANY change to the held snapshot as stale, never just a conflict.
 *
 * If the held snapshot is byte-identical (only UNRELATED parts of `main` moved),
 * the rebase replays the restore cleanly and we CAS-push it (released).
 */
async function releaseAttempt(
	ctx: ReleaseAttemptContext,
): Promise<ReleaseAttemptResult> {
	const {
		arbiter,
		slug,
		prd,
		slicing,
		releaseBranch,
		lockedBlob,
		emitSlices,
		markSliced,
		routeToNeedsAttention,
		cwd,
		env,
		note,
	} = ctx;

	await gitHard(['fetch', '--quiet', arbiter], cwd, env);

	// The lock must currently be held: work/slicing/<slug>.md present on main.
	if (!(await catFileExists(`${arbiter}/main:${slicing}`, cwd, env))) {
		const message = `'${slug}' is not locked for slicing on ${arbiter}/main (no work/slicing/${slug}.md) — nothing to release.`;
		note(message);
		return {kind: 'lost', message};
	}

	const currentBase = (
		await gitHard(['rev-parse', `${arbiter}/main`], cwd, env)
	).stdout.trim();

	// STALE CHECK (content-identity, the read-stability backstop): did the held PRD
	// body change on the arbiter since the lock TOOK it? Compare the snapshot blob
	// the lock recorded (`lockedBlob`) against the CURRENTLY held
	// work/slicing/<slug>.md blob on main. ANY difference = a concurrent edit under
	// the lock = the slicing is STALE = fail loud, touch NOTHING.
	//
	// This must be a content-identity check, NOT merely a textual rebase conflict:
	// git's rename+edit merge can apply a slicing-body edit CLEANLY onto the
	// restore, silently carrying the edit into prd/ while the already-emitted slices
	// were derived from the OLD body — exactly the silent stale-slice drift the
	// backstop must prevent (see
	// `work/observations/slicing-lock-does-not-stabilise-prd-content.md`).
	if (lockedBlob !== undefined) {
		const currentBlob = (
			await gitHard(['rev-parse', `${currentBase}:${slicing}`], cwd, env)
		).stdout.trim();
		if (currentBlob !== lockedBlob) {
			const message =
				`RELEASE CONFLICT for '${slug}': the PRD was edited (work/slicing/${slug}.md ` +
				`changed on ${arbiter}/main) while the slicing lock was held. The slicing ` +
				`is STALE — re-slice from the edited PRD or route it to ` +
				`work/needs-attention/. The arbiter was NOT modified (lock still held).`;
			note(message);
			return {kind: 'stale', message};
		}
	}

	// Fresh release branch on the CURRENT arbiter main, where we restore the PRD.
	await gitSoft(['branch', '-D', releaseBranch], cwd, env);
	await gitHard(
		['checkout', '--quiet', '-b', releaseBranch, `${arbiter}/main`],
		cwd,
		env,
	);

	// The slicer edit loop's DECOMPOSITION-UNCLEAR verdict: restore the held PRD to
	// work/needs-attention/<slug>.md (NOT work/prd/) with the reason as body prose,
	// emitting NO guessed slices and NOT marking the PRD sliced. The lock is still
	// released (the PRD leaves slicing/), but it lands in needs-attention so it is
	// not re-sliceable until a human resolves it.
	if (routeToNeedsAttention !== undefined) {
		const naRel = `work/needs-attention/${slug}.md`;
		const naAbs = join(cwd, naRel);
		mkdirSync(dirname(naAbs), {recursive: true});
		const mvNa = await gitSoft(['mv', slicing, naRel], cwd, env);
		if (mvNa.status !== 0) {
			throw new SlicingLockUsageError(
				`git mv failed for '${slicing}' (unexpected — aborting release)`,
			);
		}
		writeFileSync(
			naAbs,
			appendNeedsAttentionReason(
				readFileSync(naAbs, 'utf8'),
				routeToNeedsAttention.reason,
			),
		);
		await gitHard(['add', '--', naRel], cwd, env);
		await gitHard(
			[
				'commit',
				'--quiet',
				'-m',
				`slicing: route ${slug} to needs-attention (by ${ctx.by})`,
			],
			cwd,
			env,
		);
	} else {
		// Restore the PRD: work/slicing/<slug>.md -> work/prd/<slug>.md.
		const prdAbs = join(cwd, prd);
		mkdirSync(dirname(prdAbs), {recursive: true});
		const mv = await gitSoft(['mv', slicing, prd], cwd, env);
		if (mv.status !== 0) {
			throw new SlicingLockUsageError(
				`git mv failed for '${slicing}' (unexpected — aborting release)`,
			);
		}

		// COMPLETING `do prd:` transition: fold the produced backlog slices + the
		// PRD's `sliced:` marker INTO this SAME release commit, so the emitted backlog,
		// the lock release, and the marker are ONE runner-owned transition (the agent
		// never does git). A bare release (no emitSlices/markSliced) is unchanged.
		if (markSliced !== undefined) {
			const current = readFileSync(prdAbs, 'utf8');
			writeFileSync(prdAbs, setSlicedMarker(current, markSliced));
			await gitHard(['add', '--', prd], cwd, env);
		}
		if (emitSlices) {
			for (const [relPath, content] of Object.entries(emitSlices)) {
				const abs = join(cwd, relPath);
				mkdirSync(dirname(abs), {recursive: true});
				writeFileSync(abs, content);
				await gitHard(['add', '--', relPath], cwd, env);
			}
		}

		await gitHard(
			['commit', '--quiet', '-m', `slicing: release ${slug} (by ${ctx.by})`],
			cwd,
			env,
		);
	}

	// CAS-push the restore through the seam (kind `slicing`, lease = current main).
	// The branch is already ON current main (no rebase needed — we restore from
	// the held file as it stands, which the stale check just proved is the locked
	// snapshot). The lease guards against main moving between our read and push;
	// if it does, the seam returns `rejected` and the outer loop refetches and
	// re-runs the stale check against the NEW main.
	const head = (await gitHard(['rev-parse', 'HEAD'], cwd, env)).stdout.trim();
	if (head === currentBase) {
		// No-op restore (should not happen — the mv always changes the tree).
		throw new SlicingLockUsageError(
			'slicing-release commit is a no-op (nothing moved) — aborting',
		);
	}
	const result = await ledgerWrite.applyTransition({
		kind: 'slicing',
		arbiter,
		localBranch: releaseBranch,
		expectedBase: currentBase,
		head,
		cwd,
		env,
		note,
	});
	if (result.kind === 'published') {
		const message =
			routeToNeedsAttention !== undefined
				? `RELEASED '${slug}' -> work/needs-attention/ on ${arbiter}/main (decomposition unclear; no slices emitted).`
				: `RELEASED '${slug}' -> work/prd/ on ${arbiter}/main (slicing/ empty).`;
		note(message);
		return {kind: 'released', message};
	}
	return {kind: 'rejected', message: result.message};
}

/** Marker that opens the reason block in a routed PRD's needs-attention body. */
const NEEDS_ATTENTION_REASON_HEADING = '## Needs attention';

/**
 * Append a `## Needs attention` reason block (prose, never a frontmatter field —
 * WORK-CONTRACT rule 3) to a PRD routed to needs-attention by the slicer edit
 * loop's decomposition-unclear verdict. Mirrors the body-prose reason the
 * needs-attention move helper records for build bounces.
 */
function appendNeedsAttentionReason(content: string, reason: string): string {
	const base = content.replace(/\s*$/, '');
	return [base, '', NEEDS_ATTENTION_REASON_HEADING, '', reason, ''].join('\n');
}

// --- Shared helpers (same shape as claim-cas.ts) --------------------------

/** The branch (or detached HEAD sha) we should return to afterward. */
async function originalRef(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
	const sym = await gitSoft(
		['symbolic-ref', '--quiet', '--short', 'HEAD'],
		cwd,
		env,
	);
	if (sym.status === 0 && sym.stdout.trim() !== '') {
		return sym.stdout.trim();
	}
	return (await gitHard(['rev-parse', 'HEAD'], cwd, env)).stdout.trim();
}

/** Best-effort: return to where we were and drop the throwaway lock branch. */
async function cleanup(
	cwd: string,
	origRef: string,
	branch: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<void> {
	await gitSoft(['checkout', '--quiet', origRef], cwd, env);
	await gitSoft(['branch', '-D', branch], cwd, env);
}

/** Resolve the advisory locker: git user.name, else $USER/$USERNAME, else ''. */
async function resolveBy(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
	const name = await gitSoft(['config', 'user.name'], cwd, env);
	if (name.status === 0 && name.stdout.trim() !== '') {
		return name.stdout.trim();
	}
	const e = env ?? process.env;
	return e.USER ?? e.USERNAME ?? '';
}

/** `git cat-file -e <object>` — true iff the object exists. */
async function catFileExists(
	object: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
	return (await gitSoft(['cat-file', '-e', object], cwd, env)).status === 0;
}

/** Run git, returning the raw result (no throw) — for soft checks. */
function gitSoft(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<RunResult> {
	return runAsync('git', args, cwd, {env});
}

/** Run git; throw on non-zero (genuinely unexpected plumbing failures). */
async function gitHard(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<RunResult> {
	const result = await runAsync('git', args, cwd, {env});
	if (result.status !== 0) {
		throw new Error(
			`git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr.trim()}`,
		);
	}
	return result;
}
