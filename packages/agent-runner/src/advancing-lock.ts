import {existsSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {dirname, isAbsolute, join} from 'node:path';
import {runAsync, type RunResult} from './git.js';
import {ledgerWrite} from './ledger-write.js';
import {resolveSidecarIdentity} from './sidecar.js';

/**
 * The **advancing-lock BORROW** (PRD `advance-loop`, slice
 * `advancing-lock-borrow`, US #19–24).
 *
 * The surface/apply/triage phase's SHORT borrow — shaped like the slicing lock
 * (`slicing-lock.ts`), reusing the proven CAS ledger-write primitive
 * ({@link ledgerWrite.applyTransition}), NOT a new lock mechanism. ONE lock
 * PRIMITIVE; the lock-FOLDER encodes the ACTION (`advancing`) and the entry name
 * (`<type>-<slug>`) encodes the IDENTITY (the SAME type-encoded scheme the
 * sidecar uses, via {@link resolveSidecarIdentity} — the resolver is the single
 * source of truth). So a slice, a PRD, and an observation that share a slug NEVER
 * collide on the CAS ref, and a PRD may hold an `advancing` borrow and (later,
 * separately) a `slicing` borrow — different actions, different refs, never
 * co-held.
 *
 * It differs from the slicing lock + the build claim in ONE deliberate way: it is
 * file-ORTHOGONAL to the item it locks. The slicing lock IS the PRD file moved
 * `prd/ → slicing/`, and the build claim IS the slice file moved
 * `backlog/ → in-progress/`; an advancing borrow is a separate PRESENCE-MARKER
 * file `work/advancing/<type>-<slug>.md`, created by the CAS micro-commit on
 * {@link acquireAdvancingLock} and deleted on {@link releaseAdvancingLock}. The
 * item's own lifecycle file NEVER moves (the borrow is a LOCK, not a lifecycle
 * transition), which is exactly why it can lock items resting in DIFFERENT source
 * folders (a backlog slice, a `prd/` PRD, an `observations/` note) with one
 * uniform mechanism, and why it must be identity-keyed rather than folder-keyed.
 *
 *   - **Acquire** ({@link acquireAdvancingLock}) atomically races a
 *     `+ work/advancing/<type>-<slug>.md` micro-commit through the seam
 *     (transition kind `advancing`), on the branch `advancing/<type>-<slug>` —
 *     DISTINCT from the build-claim's `claim/<slug>`, the slicing lock's
 *     `slicing/<slug>`, and the work branch `work/<type>-<slug>`, so an advancing
 *     borrow can never collide with a slicing borrow or a build claim of the same
 *     slug. The winner HOLDS the lock; a loser gets the CAS's exit-2 ('lost') and
 *     backs off.
 *   - **Release** ({@link releaseAdvancingLock}) deletes the marker
 *     `work/advancing/<type>-<slug>.md` against the CURRENT arbiter `main` (a
 *     normal commit on the latest `main`, CAS-leased so it can only fast-forward,
 *     NEVER `--force`). It moves NO lifecycle file — the item is returned to the
 *     caller exactly where it rested.
 *
 * This module also delivers {@link createItemThroughCas}: new-item creation routed
 * THROUGH the SAME CAS, keyed on the NEW item's identity (its target path), so the
 * (unlikely) same-slug new-item race needs NO special case — the loser simply
 * fails the CAS and backs off. The triage rung (observation→promote drafting a new
 * `work/backlog/<new-slug>.md`) consumes it.
 *
 * Lock discipline: MANDATORY for the autonomous driver (a contender may be active),
 * a no-op formality for a solo human (no contender). The per-repo "agents may
 * advance here" policy is the signal that a contender may be active, so the common
 * solo case stays simple. `needsAnswers` is the PURE answer-required axis, NOT a
 * lock; the human edit-handshake becomes "take the `advancing` lock via CAS"
 * (supersedes `work/ideas/folder-taxonomy-and-prd-edit-handshake.md`). This module
 * provides the lock + creation PRIMITIVES only; the rungs that wire them are LATER
 * slices.
 */

const DEFAULT_ARBITER = 'origin';

/**
 * The single PATH-CONSTRUCTION SEAM for the advancing borrow's marker file —
 * `work/advancing/<entry>.md`, where `<entry>` is the type-encoded `<type>-<slug>`
 * identity ({@link resolveSidecarIdentity}). Acquire and release BOTH construct
 * the marker through THIS function (do NOT inline the path elsewhere), so the
 * folder-taxonomy reorg slice can repoint the marker's location in ONE place
 * (`work/<entry>/<slug>.lock.md` etc.) without forking the format between
 * acquire and release. `<type>-<slug>` stays in the lock + release BRANCH names
 * (`advancing/<entry>` / `advancing-release/<entry>`) — that is load-bearing for
 * cross-type/cross-repo branch-collision avoidance regardless of where the
 * MARKER FILE later lives.
 */
export function advancingMarkerPath(entry: string): string {
	return `work/advancing/${entry}.md`;
}

// --- Acquire --------------------------------------------------------------

/** A semantic label for the lock-acquire outcome (never the verdict itself). */
export type AcquireAdvancingLockOutcome =
	| 'acquired'
	| 'usage-error'
	| 'lost'
	| 'contended';

/** Maps onto the claim-CAS exit codes (identical semantics). */
export type AcquireAdvancingLockExitCode = 0 | 1 | 2 | 3;

export interface AcquireAdvancingLockOptions {
	/**
	 * The NAMESPACED item identity to lock (`slice:<slug>` / `prd:<slug>` /
	 * `obs:<slug>` / `observation:<slug>`, or a bare `<slug>` = slice). The
	 * resolver derives the type-encoded entry `<type>-<slug>` from it.
	 */
	item: string;
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

export interface AcquireAdvancingLockResult {
	exitCode: AcquireAdvancingLockExitCode;
	outcome: AcquireAdvancingLockOutcome;
	/** Human-readable summary of the terminal condition. */
	message: string;
	/**
	 * The type-encoded lock entry name (`<type>-<slug>`) the borrow keyed onto —
	 * the marker is `work/advancing/<entry>.md`, the branch `advancing/<entry>`.
	 * Surfaced so the caller hands the SAME entry back to
	 * {@link releaseAdvancingLock} (and so tests can assert the type-encoding).
	 */
	entry?: string;
}

/** Raised for usage/environment errors (exit 1). */
class AdvancingLockUsageError extends Error {}

/** Internal: the result of a single acquire attempt. */
type AcquireAttemptResult =
	| {kind: 'acquired'; message: string}
	| {kind: 'lost'; message: string}
	| {kind: 'rejected'; message: string};

/**
 * Acquire the advancing borrow for `item`: race a `+ work/advancing/<entry>.md`
 * micro-commit to the arbiter via the seam CAS. Never throws for the expected
 * "lost the race" (exit 2) or "contended" (exit 3) cases — those are returned.
 * Usage/environment problems surface as exit 1; a held lock is exit 0. Mirrors
 * `acquireSlicingLock`'s control flow (it IS the same CAS, on a different folder
 * + branch, creating a marker instead of moving the item).
 */
export async function acquireAdvancingLock(
	options: AcquireAdvancingLockOptions,
): Promise<AcquireAdvancingLockResult> {
	const note = options.note ?? (() => {});
	try {
		return await runAcquire(options, note);
	} catch (err) {
		if (err instanceof AdvancingLockUsageError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}
}

async function runAcquire(
	options: AcquireAdvancingLockOptions,
	note: (m: string) => void,
): Promise<AcquireAdvancingLockResult> {
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const retries = options.retries ?? 3;
	const dryRun = options.dryRun ?? false;
	const cwd = options.cwd;
	const env = options.env;

	if (!options.item) {
		throw new AdvancingLockUsageError(
			'missing <item>. usage: acquireAdvancingLock({item, cwd, arbiter})',
		);
	}
	// The type-encoded entry `<type>-<slug>` — the SAME identity scheme the sidecar
	// uses, derived via the shared resolver (the single source of truth).
	const {type, slug} = resolveSidecarIdentity(options.item);
	const entry = `${type}-${slug}`;

	if ((await gitSoft(['rev-parse', '--git-dir'], cwd, env)).status !== 0) {
		throw new AdvancingLockUsageError('not inside a git repository');
	}
	if ((await gitSoft(['remote', 'get-url', arbiter], cwd, env)).status !== 0) {
		throw new AdvancingLockUsageError(
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
		throw new AdvancingLockUsageError(
			'working tree has uncommitted changes; commit/stash them before locking',
		);
	}

	const marker = advancingMarkerPath(entry);
	// DISTINCT from the build-claim's `claim/<slug>`, the slicing lock's
	// `slicing/<slug>`, and the work branch `work/<type>-<slug>` — an advancing
	// borrow can never collide with a slicing borrow or a build claim.
	const lockBranch = `advancing/${entry}`;

	const origRef = await originalRef(cwd, env);
	try {
		let i = 0;
		// eslint-disable-next-line no-constant-condition
		while (true) {
			const result = await acquireAttempt({
				entry,
				by,
				arbiter,
				dryRun,
				cwd,
				env,
				marker,
				lockBranch,
				note,
			});
			if (result.kind === 'acquired') {
				return {
					exitCode: 0,
					outcome: 'acquired',
					message: result.message,
					entry,
				};
			}
			if (result.kind === 'lost') {
				return {exitCode: 2, outcome: 'lost', message: result.message, entry};
			}
			// rejected: main moved under us — retry up to the cap, then back off.
			i += 1;
			if (i > retries) {
				const message = `push rejected ${i} times (main is contended). Try again shortly.`;
				note(message);
				return {exitCode: 3, outcome: 'contended', message, entry};
			}
			note(`main advanced under us — refetch and retry (${i}/${retries})...`);
		}
	} finally {
		await cleanup(cwd, origRef, lockBranch, env);
	}
}

interface AcquireAttemptContext {
	entry: string;
	by: string;
	arbiter: string;
	dryRun: boolean;
	cwd: string;
	env: NodeJS.ProcessEnv | undefined;
	marker: string;
	lockBranch: string;
	note: (m: string) => void;
}

/** One acquire attempt: branch off arbiter/main, write the marker, CAS-push. */
async function acquireAttempt(
	ctx: AcquireAttemptContext,
): Promise<AcquireAttemptResult> {
	const {arbiter, entry, marker, lockBranch, cwd, env, note} = ctx;

	await gitHard(['fetch', '--quiet', arbiter], cwd, env);

	// Is the lock still free on the arbiter's main? (the marker absent.)
	if (await catFileExists(`${arbiter}/main:${marker}`, cwd, env)) {
		const message = `'${entry}' is already being advanced (advancing lock held) on ${arbiter}/main — someone holds the borrow. Back off.`;
		note(message);
		return {kind: 'lost', message};
	}

	// Fresh lock branch off the latest arbiter main. DETACH first so the throwaway
	// branch can always be deleted across retries (HEAD may still be ON it).
	await gitHard(
		['checkout', '--quiet', '--detach', `${arbiter}/main`],
		cwd,
		env,
	);
	await gitSoft(['branch', '-D', lockBranch], cwd, env);
	await gitHard(
		['checkout', '--quiet', '-b', lockBranch, `${arbiter}/main`],
		cwd,
		env,
	);

	// Create the presence marker, then stage + commit it. A failed add must abort
	// (fatal), never silently continue — guarding against a false "acquired".
	const markerAbs = join(cwd, marker);
	mkdirSync(dirname(markerAbs), {recursive: true});
	writeFileSync(markerAbs, advancingMarkerBody(entry, ctx.by));
	const add = await gitSoft(['add', '--', marker], cwd, env);
	if (add.status !== 0) {
		throw new AdvancingLockUsageError(
			`git add failed for '${marker}' (unexpected — aborting lock)`,
		);
	}

	await gitHard(
		['commit', '--quiet', '-m', `advancing: lock ${entry} (by ${ctx.by})`],
		cwd,
		env,
	);

	// Sanity: the lock commit MUST be a real child of the arbiter main we branched
	// from (it actually added the marker) — guarding against a no-op that would
	// make an "Everything up-to-date" push look like a successful lock.
	const base = (
		await gitHard(['rev-parse', `${arbiter}/main`], cwd, env)
	).stdout.trim();
	const head = (await gitHard(['rev-parse', 'HEAD'], cwd, env)).stdout.trim();
	if (head === base) {
		throw new AdvancingLockUsageError(
			'advancing-lock commit is a no-op (nothing added) — aborting',
		);
	}
	const parent = (
		await gitHard(['rev-parse', 'HEAD^'], cwd, env)
	).stdout.trim();
	if (parent !== base) {
		throw new AdvancingLockUsageError(
			`advancing-lock is not a direct child of ${arbiter}/main — aborting`,
		);
	}

	// Publish the prepared lock micro-commit THROUGH the write seam (kind
	// `advancing`) — the same CAS the claim/slicing locks use; the `:main` push +
	// lease + verify all live inside the strategy, NOT here.
	if (ctx.dryRun) {
		const result = await ledgerWrite.applyTransition({
			kind: 'advancing',
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
		kind: 'advancing',
		arbiter,
		localBranch: lockBranch,
		expectedBase: base,
		head,
		cwd,
		env,
		note,
	});
	if (result.kind === 'published') {
		const message = `LOCKED '${entry}' for advancing -> work/advancing/ on ${arbiter}/main.`;
		note(message);
		return {kind: 'acquired', message};
	}
	return {kind: 'rejected', message: result.message};
}

/** The body of an advancing-lock presence marker (advisory; the lock IS the file). */
function advancingMarkerBody(entry: string, by: string): string {
	return [
		'---',
		`entry: ${entry}`,
		`by: ${by}`,
		'---',
		'',
		`Advancing lock held for \`${entry}\`. This is a TRANSIENT borrow — the`,
		'advance surface/apply/triage rung holds it and releases it; if it is here',
		'after a run, a tick died mid-borrow and it can be removed.',
		'',
	].join('\n');
}

// --- Release --------------------------------------------------------------

/** A semantic label for the lock-release outcome. */
export type ReleaseAdvancingLockOutcome =
	| 'released'
	| 'usage-error'
	| 'lost'
	| 'contended';

/** Maps onto the claim-CAS exit codes (identical semantics). */
export type ReleaseAdvancingLockExitCode = 0 | 1 | 2 | 3;

export interface ReleaseAdvancingLockOptions {
	/** The NAMESPACED item identity whose borrow to release (same forms as acquire). */
	item: string;
	/** Working clone/worktree the release runs in. */
	cwd: string;
	/** Name of the arbiter remote (`--arbiter`). Defaults to `origin`. */
	arbiter?: string;
	/** Advisory releaser id. Defaults to git user.name, then $USER. */
	by?: string;
	/** Cap on push retries when main merely advanced. Default 3. */
	retries?: number;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface ReleaseAdvancingLockResult {
	exitCode: ReleaseAdvancingLockExitCode;
	outcome: ReleaseAdvancingLockOutcome;
	/** Human-readable summary of the terminal condition. */
	message: string;
	/** The type-encoded lock entry name (`<type>-<slug>`) that was released. */
	entry?: string;
}

/**
 * Release the advancing borrow for `item`: delete the marker
 * `work/advancing/<entry>.md` against the CURRENT arbiter `main` (a normal commit
 * on the latest `main`, CAS-leased so it can only fast-forward — never a
 * force-restore). It moves NO lifecycle file: the borrow is a LOCK, not a
 * lifecycle transition, so the item is returned exactly where it rested.
 *
 * Unlike the slicing release there is NO content-identity stale check: the
 * advancing borrow does not HOLD the item's content (the item never moved), so
 * there is no held-body to go stale — a concurrent edit to the item is the apply
 * rung's concern, not the lock's. The borrow's only job is mutual exclusion.
 *
 * Outcomes:
 *   - `released` (0): the marker is gone, `work/advancing/` no longer holds it.
 *   - `usage-error` (1): bad input / environment.
 *   - `lost` (2): the lock is not held (no `work/advancing/<entry>.md` on main).
 *   - `contended` (3): the push kept failing (main churning) — try again.
 */
export async function releaseAdvancingLock(
	options: ReleaseAdvancingLockOptions,
): Promise<ReleaseAdvancingLockResult> {
	const note = options.note ?? (() => {});
	try {
		return await runRelease(options, note);
	} catch (err) {
		if (err instanceof AdvancingLockUsageError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}
}

async function runRelease(
	options: ReleaseAdvancingLockOptions,
	note: (m: string) => void,
): Promise<ReleaseAdvancingLockResult> {
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const retries = options.retries ?? 3;
	const cwd = options.cwd;
	const env = options.env;

	if (!options.item) {
		throw new AdvancingLockUsageError(
			'missing <item>. usage: releaseAdvancingLock({item, cwd, arbiter})',
		);
	}
	const {type, slug} = resolveSidecarIdentity(options.item);
	const entry = `${type}-${slug}`;

	if ((await gitSoft(['rev-parse', '--git-dir'], cwd, env)).status !== 0) {
		throw new AdvancingLockUsageError('not inside a git repository');
	}
	if ((await gitSoft(['remote', 'get-url', arbiter], cwd, env)).status !== 0) {
		throw new AdvancingLockUsageError(
			`no git remote named '${arbiter}' (set one, or pass --arbiter)`,
		);
	}
	const by = options.by || (await resolveBy(cwd, env));

	const marker = advancingMarkerPath(entry);
	const releaseBranch = `advancing-release/${entry}`;

	// CRASH-SAFETY (slice `advancing-lock-release-crash-safe`). A failing post-lock
	// dispatch (recover/integrate hitting a rebase conflict, a build bailing mid-
	// flight, …) can leave `cwd` mid-rebase or with uncommitted leftovers. The
	// release itself uses a SCRATCH branch cut from `<arbiter>/main` (it never
	// consumes the dirty content), so the dirt is INCIDENTAL — but the scratch
	// checkout below refuses on a mid-rebase / locally-modified tree. Become
	// checkout-able FIRST, NEVER destroying committed work: the kept work lives on
	// the WORK BRANCH REF (commits), not on the dirty tree. `git rebase --abort`
	// restores the pre-rebase tip; `git checkout HEAD -- .` + `git clean -fdq`
	// clear ONLY uncommitted/untracked dispatch leftovers. NEVER `git reset --hard`
	// (no branch-rewinding) — only the worktree dirt that was never committed is
	// dropped. A happy path's clean tree makes this a no-op.
	await makeCheckoutAble(cwd, env, note);

	const origRef = await originalRef(cwd, env);
	try {
		let i = 0;
		// eslint-disable-next-line no-constant-condition
		while (true) {
			const result = await releaseAttempt({
				entry,
				by,
				arbiter,
				cwd,
				env,
				marker,
				releaseBranch,
				note,
			});
			if (result.kind === 'released') {
				return {
					exitCode: 0,
					outcome: 'released',
					message: result.message,
					entry,
				};
			}
			if (result.kind === 'lost') {
				return {exitCode: 2, outcome: 'lost', message: result.message, entry};
			}
			// rejected: main moved under us — refetch, re-attempt, cap at retries.
			i += 1;
			if (i > retries) {
				const message = `push rejected ${i} times (main is contended). Try again shortly.`;
				note(message);
				return {exitCode: 3, outcome: 'contended', message, entry};
			}
			note(`main advanced under us — refetch and retry (${i}/${retries})...`);
		}
	} finally {
		await cleanup(cwd, origRef, releaseBranch, env);
	}
}

interface ReleaseAttemptContext {
	entry: string;
	by: string;
	arbiter: string;
	cwd: string;
	env: NodeJS.ProcessEnv | undefined;
	marker: string;
	releaseBranch: string;
	note: (m: string) => void;
}

type ReleaseAttemptResult =
	| {kind: 'released'; message: string}
	| {kind: 'lost'; message: string}
	| {kind: 'rejected'; message: string};

/** One release attempt: branch off current main, rm the marker, CAS-push. */
async function releaseAttempt(
	ctx: ReleaseAttemptContext,
): Promise<ReleaseAttemptResult> {
	const {arbiter, entry, marker, releaseBranch, cwd, env, note} = ctx;

	await gitHard(['fetch', '--quiet', arbiter], cwd, env);

	// The lock must currently be held: work/advancing/<entry>.md present on main.
	if (!(await catFileExists(`${arbiter}/main:${marker}`, cwd, env))) {
		const message = `'${entry}' is not locked for advancing on ${arbiter}/main (no ${marker}) — nothing to release.`;
		note(message);
		return {kind: 'lost', message};
	}

	const base = (
		await gitHard(['rev-parse', `${arbiter}/main`], cwd, env)
	).stdout.trim();

	// Fresh release branch on the CURRENT arbiter main, where we remove the marker.
	await gitHard(
		['checkout', '--quiet', '--detach', `${arbiter}/main`],
		cwd,
		env,
	);
	await gitSoft(['branch', '-D', releaseBranch], cwd, env);
	await gitHard(
		['checkout', '--quiet', '-b', releaseBranch, `${arbiter}/main`],
		cwd,
		env,
	);

	// Remove the marker. A failed rm must abort (fatal), never silently continue.
	const rm = await gitSoft(['rm', '--quiet', '--', marker], cwd, env);
	if (rm.status !== 0) {
		throw new AdvancingLockUsageError(
			`git rm failed for '${marker}' (unexpected — aborting release)`,
		);
	}

	await gitHard(
		['commit', '--quiet', '-m', `advancing: release ${entry} (by ${ctx.by})`],
		cwd,
		env,
	);

	const head = (await gitHard(['rev-parse', 'HEAD'], cwd, env)).stdout.trim();
	if (head === base) {
		throw new AdvancingLockUsageError(
			'advancing-release commit is a no-op (nothing removed) — aborting',
		);
	}

	// CAS-push the release through the seam (kind `advancing`, lease = current main).
	const result = await ledgerWrite.applyTransition({
		kind: 'advancing',
		arbiter,
		localBranch: releaseBranch,
		expectedBase: base,
		head,
		cwd,
		env,
		note,
	});
	if (result.kind === 'published') {
		const message = `RELEASED '${entry}' -> advancing borrow cleared on ${arbiter}/main (item untouched).`;
		note(message);
		return {kind: 'released', message};
	}
	return {kind: 'rejected', message: result.message};
}

// --- New-item creation through the CAS ------------------------------------

/** A semantic label for the new-item creation outcome. */
export type CreateItemOutcome =
	| 'created'
	| 'usage-error'
	| 'lost'
	| 'contended';

/** Maps onto the claim-CAS exit codes (identical semantics). */
export type CreateItemExitCode = 0 | 1 | 2 | 3;

export interface CreateItemThroughCasOptions {
	/**
	 * The NEW item's path RELATIVE to the repo root (e.g.
	 * `work/backlog/<new-slug>.md`). The CAS is keyed on THIS path (the new item's
	 * identity): two concurrent creators of the same path race, the loser fails the
	 * CAS — no special case for the (unlikely) same-slug new-item collision.
	 */
	path: string;
	/** The new item's file content. */
	content: string;
	/** Working clone/worktree the creation runs in. */
	cwd: string;
	/** Name of the arbiter remote (`--arbiter`). Defaults to `origin`. */
	arbiter?: string;
	/** Advisory creator id. Defaults to git user.name, then $USER. */
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

export interface CreateItemThroughCasResult {
	exitCode: CreateItemExitCode;
	outcome: CreateItemOutcome;
	/** Human-readable summary of the terminal condition. */
	message: string;
}

/** Internal: the result of a single create attempt. */
type CreateAttemptResult =
	| {kind: 'created'; message: string}
	| {kind: 'lost'; message: string}
	| {kind: 'rejected'; message: string};

/**
 * Create a NEW `work/` item THROUGH the CAS, keyed on the new item's identity (its
 * `path`). The reusable helper the triage rung consumes when an observation→promote
 * drafts a new `work/backlog/<new-slug>.md`: the (unlikely) same-slug new-item race
 * needs NO special case — exactly one creator lands the file, the loser fails the
 * CAS (exit 2) and backs off. Same CAS-micro-commit / force-with-lease shape as the
 * locks; it is NOT a lock (it does not hold a borrow), it ATOMICALLY publishes a new
 * file iff that path is still absent on the arbiter.
 */
export async function createItemThroughCas(
	options: CreateItemThroughCasOptions,
): Promise<CreateItemThroughCasResult> {
	const note = options.note ?? (() => {});
	try {
		return await runCreate(options, note);
	} catch (err) {
		if (err instanceof AdvancingLockUsageError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}
}

async function runCreate(
	options: CreateItemThroughCasOptions,
	note: (m: string) => void,
): Promise<CreateItemThroughCasResult> {
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const retries = options.retries ?? 3;
	const dryRun = options.dryRun ?? false;
	const cwd = options.cwd;
	const env = options.env;
	const path = options.path;

	if (!path) {
		throw new AdvancingLockUsageError(
			'missing <path>. usage: createItemThroughCas({path, content, cwd, arbiter})',
		);
	}
	if ((await gitSoft(['rev-parse', '--git-dir'], cwd, env)).status !== 0) {
		throw new AdvancingLockUsageError('not inside a git repository');
	}
	if ((await gitSoft(['remote', 'get-url', arbiter], cwd, env)).status !== 0) {
		throw new AdvancingLockUsageError(
			`no git remote named '${arbiter}' (set one, or pass --arbiter)`,
		);
	}
	const by = options.by || (await resolveBy(cwd, env));

	const dirtyWorktree =
		(await gitSoft(['diff', '--quiet'], cwd, env)).status !== 0;
	const dirtyIndex =
		(await gitSoft(['diff', '--cached', '--quiet'], cwd, env)).status !== 0;
	if (dirtyWorktree || dirtyIndex) {
		throw new AdvancingLockUsageError(
			'working tree has uncommitted changes; commit/stash them before creating',
		);
	}

	// A throwaway create branch, slugified off the new item's path (so concurrent
	// creators of DIFFERENT paths don't collide on the branch name either).
	const createBranch = `create/${path.replace(/[^A-Za-z0-9._-]+/g, '-')}`;

	const origRef = await originalRef(cwd, env);
	try {
		let i = 0;
		// eslint-disable-next-line no-constant-condition
		while (true) {
			const result = await createAttempt({
				path,
				content: options.content,
				by,
				arbiter,
				dryRun,
				cwd,
				env,
				createBranch,
				note,
			});
			if (result.kind === 'created') {
				return {exitCode: 0, outcome: 'created', message: result.message};
			}
			if (result.kind === 'lost') {
				return {exitCode: 2, outcome: 'lost', message: result.message};
			}
			i += 1;
			if (i > retries) {
				const message = `push rejected ${i} times (main is contended). Try again shortly.`;
				note(message);
				return {exitCode: 3, outcome: 'contended', message};
			}
			note(`main advanced under us — refetch and retry (${i}/${retries})...`);
		}
	} finally {
		await cleanup(cwd, origRef, createBranch, env);
	}
}

interface CreateAttemptContext {
	path: string;
	content: string;
	by: string;
	arbiter: string;
	dryRun: boolean;
	cwd: string;
	env: NodeJS.ProcessEnv | undefined;
	createBranch: string;
	note: (m: string) => void;
}

/** One create attempt: branch off arbiter/main, add the new file, CAS-push. */
async function createAttempt(
	ctx: CreateAttemptContext,
): Promise<CreateAttemptResult> {
	const {arbiter, path, content, createBranch, cwd, env, note} = ctx;

	await gitHard(['fetch', '--quiet', arbiter], cwd, env);

	// Is the path still free on the arbiter's main? (the new item absent.)
	if (await catFileExists(`${arbiter}/main:${path}`, cwd, env)) {
		const message = `'${path}' already exists on ${arbiter}/main — the new item lost the create race (or the slug is taken). Back off.`;
		note(message);
		return {kind: 'lost', message};
	}

	await gitHard(
		['checkout', '--quiet', '--detach', `${arbiter}/main`],
		cwd,
		env,
	);
	await gitSoft(['branch', '-D', createBranch], cwd, env);
	await gitHard(
		['checkout', '--quiet', '-b', createBranch, `${arbiter}/main`],
		cwd,
		env,
	);

	const fileAbs = join(cwd, path);
	mkdirSync(dirname(fileAbs), {recursive: true});
	writeFileSync(fileAbs, content);
	const add = await gitSoft(['add', '--', path], cwd, env);
	if (add.status !== 0) {
		throw new AdvancingLockUsageError(
			`git add failed for '${path}' (unexpected — aborting create)`,
		);
	}

	await gitHard(
		['commit', '--quiet', '-m', `advance: create ${path} (by ${ctx.by})`],
		cwd,
		env,
	);

	const base = (
		await gitHard(['rev-parse', `${arbiter}/main`], cwd, env)
	).stdout.trim();
	const head = (await gitHard(['rev-parse', 'HEAD'], cwd, env)).stdout.trim();
	if (head === base) {
		throw new AdvancingLockUsageError(
			'advance-create commit is a no-op (nothing added) — aborting',
		);
	}

	// Publish through the SAME seam (kind `advancing`) — keyed on the new item's
	// identity (its path). The lease guards the CAS: a concurrent creator that
	// landed first advanced main past our base, so our lease fails → rejected; the
	// outer loop refetches and the next attempt finds the path TAKEN → lost (no
	// special case). This holds EVEN for a same-identity racer who built an
	// identical create commit within git's 1-second timestamp resolution: the seam
	// stamps each attempt with a per-attempt `CAS-Nonce`, so the two racers'
	// commits have DISTINCT shas — the loser's push is a genuine lease rejection,
	// NOT an "Everything up-to-date" no-op that would spuriously verify as won.
	if (ctx.dryRun) {
		const result = await ledgerWrite.applyTransition({
			kind: 'advancing',
			arbiter,
			localBranch: createBranch,
			expectedBase: base,
			head,
			cwd,
			dryRun: true,
			env,
			note,
		});
		return {kind: 'created', message: result.message};
	}

	const result = await ledgerWrite.applyTransition({
		kind: 'advancing',
		arbiter,
		localBranch: createBranch,
		expectedBase: base,
		head,
		cwd,
		env,
		note,
	});
	if (result.kind === 'published') {
		const message = `CREATED '${path}' on ${arbiter}/main.`;
		note(message);
		return {kind: 'created', message};
	}
	return {kind: 'rejected', message: result.message};
}

// --- Shared helpers (same shape as claim-cas.ts / slicing-lock.ts) --------

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

/** Best-effort: return to where we were and drop the throwaway branch. */
async function cleanup(
	cwd: string,
	origRef: string,
	branch: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<void> {
	await gitSoft(['checkout', '--quiet', origRef], cwd, env);
	await gitSoft(['branch', '-D', branch], cwd, env);
}

/**
 * Become CHECKOUT-ABLE before the scratch-branch CAS runs (see the call site in
 * {@link runRelease}). A failing post-lock dispatch may leave `cwd` mid-rebase
 * or with uncommitted leftovers; the kept work lives on the WORK BRANCH REF
 * (commits), not on the dirty tree, so we restore the pre-rebase tip and clear
 * UNCOMMITTED dirt only — NEVER `git reset --hard`, NEVER any branch-rewinding,
 * NEVER discarding commits. A clean tree makes this a no-op (the happy path).
 */
async function makeCheckoutAble(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
	note: (m: string) => void,
): Promise<void> {
	const gitDirRel = (
		await gitSoft(['rev-parse', '--git-dir'], cwd, env)
	).stdout.trim();
	if (gitDirRel !== '') {
		const gitDirAbs = isAbsolute(gitDirRel) ? gitDirRel : join(cwd, gitDirRel);
		if (
			existsSync(join(gitDirAbs, 'rebase-merge')) ||
			existsSync(join(gitDirAbs, 'rebase-apply'))
		) {
			note(
				'advancing-release: aborting in-progress rebase to make the worktree ' +
					'checkout-able (kept commits on the branch ref are preserved).',
			);
			await gitSoft(['rebase', '--abort'], cwd, env);
		}
	}
	// Discard uncommitted dispatch leftovers in tracked files + the index, then
	// untracked dropped files — making the scratch `git checkout` below proceed.
	// The kept work is on the WORK BRANCH REF, so nothing recoverable is lost.
	await gitSoft(['checkout', 'HEAD', '--', '.'], cwd, env);
	await gitSoft(['clean', '-fdq'], cwd, env);
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
