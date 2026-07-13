import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {
	prepareTreelessSurfaceCommit,
	resolveBounceItemBodyPathOnMain,
	surfaceStuckToNeedsAttention,
} from '../src/needs-attention.js';
import {
	acquireItemLock,
	classifyItemLockAgainstMain,
	reconcileItemLockAgainstMain,
	resumeItemLock,
	readItemLock,
	itemLockRef,
} from '../src/item-lock.js';
import {run} from '../src/git.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	needsAnswersOnArbiterMain,
	sidecarSurfacedOnArbiterMain,
	stuckLockOnArbiter,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * PR-2a (task `bounce-atomic-cutover-retire-stuck-lock`, spec
 * `surface-stuck-as-questions-and-retire-stuck-lock-state`, user stories 1/3/4;
 * decisions #1 / #4): the MECHANISM tests for the bounce cutover.
 *
 * The four primitives PR-2b will wire in (the actual seam re-point + the
 * 84-assertion migration is PR-2b's atomic job) are:
 *
 *   1. the **classifier fold** on `classifyItemLockAgainstMain` /
 *      `reconcileItemLockAgainstMain` — a held `active` lock over a
 *      non-terminal item that is SURFACED on `<arbiter>/main`
 *      (needsAnswers:true + matching sidecar) is a crash-window orphan and
 *      classifies as `cleared-stale` (cleared, main-authoritative);
 *   2. the **main-authoritative recovery predicate** wired ADDITIVELY into
 *      `resumeItemLock` and `reapStaleItemLocks` (`gc --ledger`) so the
 *      crash-orphan is clearable without touching the `stuck`-based path;
 *   3. the **D1 body-path probe helper** `resolveBounceItemBodyPathOnMain`
 *      (task: `tasks/ready` → `tasks/backlog`; spec: `specs/ready` →
 *      `specs/proposed`; observation: `notes/observations`); body-absent ⇒
 *      no-op surface but STILL releases the lock;
 *   4. the surface-FIRST-release-SECOND ORDERING inherited from
 *      `runTreelessLedgerMove` (a failed publish never releases the lock).
 *
 * Driven DIRECTLY against `prepareTreelessSurfaceCommit` /
 * `reconcileItemLockAgainstMain` — NOT through the three bounce seams (whose
 * flip + the 84 `stuckLockOnArbiter(...).toBe(true)` assertion migration land
 * together as PR-2b, per the spec's "green split" rule). PR-2a keeps every
 * pinned assertion green.
 *
 * RACE_SENSITIVE: real git against a `--bare` `file://` arbiter through the
 * shared main-CAS.
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-bounce-atomic-cutover-');
});
afterEach(() => {
	scratch.cleanup();
});

async function seedWithActiveLock(
	slug: string,
	opts: {staged?: string[]; specs?: string[]} = {},
): Promise<{repo: string}> {
	const seeded = seedRepoWithArbiter(scratch.root, [slug], opts);
	const acquired = await acquireItemLock({
		item: `task:${slug}`,
		action: 'implement',
		cwd: seeded.repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(acquired.outcome).toBe('acquired');
	return {repo: seeded.repo};
}

/** Publish a surface commit to `<arbiter>/main` WITHOUT releasing the lock —
 * the on-`main` state the ordered transition leaves after step 1 but BEFORE
 * step 2 (crash-window orphan). Reused by the recovery/classifier tests. */
async function surfaceButLeaveLockHeld(
	repo: string,
	slug: string,
	itemPath: string,
	reason: string,
): Promise<void> {
	// Fetch main so the base commit is available in the local clone.
	gitIn(['fetch', '-q', ARBITER], repo);
	const base = gitIn(['rev-parse', `${ARBITER}/main`], repo).trim();
	const {ref, commit} = prepareTreelessSurfaceCommit({
		cwd: repo,
		slug,
		item: `task:${slug}`,
		itemPath,
		base,
		reason,
		commitMessage: `surface task:${slug} (stuck): ${reason}`,
		refNamespace: 'surface-stuck-crash-sim',
		env: gitEnv(),
	});
	// CAS-publish the prepared commit to <arbiter>/main directly (skipping
	// releaseItemLock), simulating a crash between step 1 and step 2.
	const push = run(
		'git',
		[
			'push',
			ARBITER,
			`${commit}:refs/heads/main`,
			`--force-with-lease=refs/heads/main:${base}`,
		],
		repo,
		{env: gitEnv()},
	);
	expect(push.status).toBe(0);
	// Refresh the local tracking ref so a subsequent read sees the surface.
	gitIn(['fetch', '-q', ARBITER], repo);
	// Drop the throwaway ref (its job is done).
	run('git', ['update-ref', '-d', ref], repo, {env: gitEnv()});
}

describe('D1 body-path probe (resolveBounceItemBodyPathOnMain)', () => {
	it('resolves a TASK body under work/tasks/ready first', async () => {
		const {repo} = await seedWithActiveLock('alpha');
		const path = await resolveBounceItemBodyPathOnMain({
			cwd: repo,
			item: 'task:alpha',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(path).toBe('work/tasks/ready/alpha.md');
	});

	it('falls back to work/tasks/backlog when tasks/ready is empty', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {staged: ['beta']});
		const path = await resolveBounceItemBodyPathOnMain({
			cwd: seeded.repo,
			item: 'task:beta',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(path).toBe('work/tasks/backlog/beta.md');
	});

	it('resolves a SPEC body under work/specs/ready', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {specs: ['gamma']});
		const path = await resolveBounceItemBodyPathOnMain({
			cwd: seeded.repo,
			item: 'spec:gamma',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(path).toBe('work/specs/ready/gamma.md');
	});

	it('returns undefined when no candidate exists on <arbiter>/main', async () => {
		const {repo} = await seedWithActiveLock('alpha');
		const path = await resolveBounceItemBodyPathOnMain({
			cwd: repo,
			item: 'task:nowhere',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(path).toBeUndefined();
	});
});

describe('surfaceStuckToNeedsAttention body-absent probe (D1)', () => {
	it('body-absent ⇒ clean no-op surface + STILL releases the lock (never a dead-end held lock)', async () => {
		// A held lock over an item whose body is NOT on `<arbiter>/main` (a claim
		// that lost/raced, or a slug the bounce seam knows only by name). No
		// itemPath given — the harness probes and finds nothing.
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const acquired = await acquireItemLock({
			item: 'task:phantom',
			action: 'implement',
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(acquired.outcome).toBe('acquired');
		const beforeMain = gitIn(
			['rev-parse', `${ARBITER}/main`],
			seeded.repo,
		).trim();

		const result = await surfaceStuckToNeedsAttention({
			cwd: seeded.repo,
			slug: 'phantom',
			// No itemPath — force the D1 probe.
			reason: 'bounced but body never landed on main',
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(result.surfaced).toBe(false);
		expect(result.bodyAbsent).toBe(true);
		expect(result.released).toBe(true);
		expect(result.reasonNotSurfaced).toMatch(/no body|main/i);

		// main UNCHANGED (no-op surface).
		const afterMain = gitIn(
			['rev-parse', `${ARBITER}/main`],
			seeded.repo,
		).trim();
		expect(afterMain).toBe(beforeMain);

		// Lock GONE (still released — the invariant that no bounce leaves a
		// dead-end held lock).
		const lock = await readItemLock({
			item: 'task:phantom',
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock).toBeUndefined();
	});

	it('probe finds the body ⇒ surface lands + release fires (same one-commit atomic surface as the explicit-itemPath path)', async () => {
		const {repo} = await seedWithActiveLock('alpha');
		const result = await surfaceStuckToNeedsAttention({
			cwd: repo,
			slug: 'alpha',
			// No itemPath — force the probe to find `work/tasks/ready/alpha.md`.
			reason: 'gate failed',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.surfaced).toBe(true);
		expect(result.bodyAbsent).toBeUndefined();
		expect(result.released).toBe(true);
		expect(sidecarSurfacedOnArbiterMain(repo, 'alpha')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'alpha')).toBe(true);
	});
});

describe('classifier fold — `active` + non-terminal + surfaced = cleared-stale', () => {
	it('classifyItemLockAgainstMain reports `cleared-stale` for a crash-window orphan (surfaced on main, lock still held active), WITHOUT clearing', async () => {
		const {repo} = await seedWithActiveLock('alpha');
		// Simulate the crash: surface landed, lock never released.
		await surfaceButLeaveLockHeld(
			repo,
			'alpha',
			'work/tasks/ready/alpha.md',
			'crash-sim',
		);

		// Sanity: item is surfaced on main + lock still held ACTIVE.
		expect(needsAnswersOnArbiterMain(repo, 'alpha')).toBe(true);
		expect(sidecarSurfacedOnArbiterMain(repo, 'alpha')).toBe(true);
		const before = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(before?.state).toBe('active');

		const verdict = await classifyItemLockAgainstMain({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(verdict.outcome).toBe('cleared-stale');
		expect(verdict.terminalOnMain).toBe(false);
		// The classifier is READ-ONLY: the lock ref is STILL held after the report.
		const after = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(after?.state).toBe('active');
	});

	it('reconcileItemLockAgainstMain CLEARS the crash-window orphan via the shared leased delete (main is authoritative)', async () => {
		const {repo} = await seedWithActiveLock('alpha');
		await surfaceButLeaveLockHeld(
			repo,
			'alpha',
			'work/tasks/ready/alpha.md',
			'crash-sim',
		);

		const rec = await reconcileItemLockAgainstMain({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(rec.outcome).toBe('cleared-stale');
		expect(rec.terminalOnMain).toBe(false);
		// The ref is GONE on the arbiter (leased delete succeeded).
		const after = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(after).toBeUndefined();
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(false);
		// The surfaced sidecar + needsAnswers on main are UNTOUCHED (main-authoritative;
		// the item is now a normal needsAnswers pool item awaiting a human answer).
		expect(sidecarSurfacedOnArbiterMain(repo, 'alpha')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'alpha')).toBe(true);
	});

	it('a genuine live hold (active, NOT surfaced) still classifies `kept-in-flight` (no false-positive clear)', async () => {
		const {repo} = await seedWithActiveLock('alpha');
		const verdict = await classifyItemLockAgainstMain({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(verdict.outcome).toBe('kept-in-flight');
		// Sanity: reconcile is also a no-op here — no needsAnswers, no sidecar.
		const rec = await reconcileItemLockAgainstMain({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(rec.outcome).toBe('kept-in-flight');
		const after = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(after?.state).toBe('active');
	});

	it('a sidecar WITHOUT needsAnswers on the body is NOT surfaced ⇒ still `kept-in-flight` (invariant: `needsAnswers ⟺ sidecar`)', async () => {
		// Seed a sidecar on main by hand but leave the item body without
		// `needsAnswers:true` — the classifier must NOT treat this as a surface.
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		mkdirSync(join(seeded.repo, 'work', 'questions'), {recursive: true});
		writeFileSync(
			join(seeded.repo, 'work', 'questions', 'task-alpha.md'),
			'---\nitem: task:alpha\n---\n\n## bogus\n\n',
		);
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'seed bare sidecar'], seeded.repo);
		gitIn(['push', '-q', ARBITER, 'main'], seeded.repo);

		const verdict = await classifyItemLockAgainstMain({
			item: 'task:alpha',
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		// A sidecar alone (without needsAnswers on the body) must NOT trip the
		// crash-window arm — this is defence in depth for the
		// `needsAnswers ⟺ sidecar` invariant that `prepareTreelessSurfaceCommit`
		// upholds on the write side.
		expect(verdict.outcome).toBe('kept-in-flight');
	});
});

describe('additive recovery predicate — resumeItemLock converges the crash-orphan', () => {
	it('resumeItemLock on an ACTIVE crash-orphan CLEARS the lock (main-authoritative), not `wrong-state`', async () => {
		const {repo} = await seedWithActiveLock('alpha');
		await surfaceButLeaveLockHeld(
			repo,
			'alpha',
			'work/tasks/ready/alpha.md',
			'crash-sim',
		);

		const r = await resumeItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(r.outcome).toBe('transitioned');
		expect(r.message).toMatch(/crash-window|SURFACED|orphan/);
		const after = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(after).toBeUndefined();
	});

	it('resumeItemLock on a genuinely-active hold (NOT surfaced) still returns `wrong-state` (the stuck-based path is untouched)', async () => {
		// The 84-assertion invariant PR-2a preserves: an active-but-unsurfaced
		// resume stays `wrong-state`, so nothing outside the crash-orphan case
		// changes semantics.
		const {repo} = await seedWithActiveLock('alpha');
		const r = await resumeItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(r.outcome).toBe('wrong-state');
	});
});

describe('surface-FIRST / release-SECOND ordering (spec decision #4)', () => {
	it('ordering: main advances with the surface commit BEFORE the lock ref is released (crash-safety comes from the ordered transition)', async () => {
		const {repo} = await seedWithActiveLock('alpha');
		const before = gitIn(['rev-parse', `${ARBITER}/main`], repo).trim();

		const result = await surfaceStuckToNeedsAttention({
			cwd: repo,
			slug: 'alpha',
			itemPath: 'work/tasks/ready/alpha.md',
			reason: 'ordered transition',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.surfaced).toBe(true);
		expect(result.released).toBe(true);

		// main advanced by exactly one surface commit whose parent is the pre-
		// surface tip — the one-commit atomic surface the ordered transition
		// pins.
		const after = gitIn(['rev-parse', `${ARBITER}/main`], repo).trim();
		expect(after).not.toBe(before);
		const parents = gitIn(['rev-list', '--parents', '-n', '1', after], repo)
			.trim()
			.split(/\s+/);
		expect(parents[1]).toBe(before);
		// Lock ref is gone — release-second landed.
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(false);
	});

	it('failed surface (missing itemPath) leaves main UNCHANGED and the lock UNRELEASED — release only fires on a successful publish', async () => {
		const {repo} = await seedWithActiveLock('alpha');
		const beforeMain = gitIn(['rev-parse', `${ARBITER}/main`], repo).trim();

		const result = await surfaceStuckToNeedsAttention({
			cwd: repo,
			slug: 'alpha',
			itemPath: 'work/tasks/ready/does-not-exist.md',
			reason: 'stuck',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.surfaced).toBe(false);
		expect(result.released).toBe(false);
		expect(result.bodyAbsent).toBeUndefined();

		const afterMain = gitIn(['rev-parse', `${ARBITER}/main`], repo).trim();
		expect(afterMain).toBe(beforeMain);
		const lock = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock?.state).toBe('active');
	});
});

describe('crash-safety (spec user story 4: one crash-safe transition, main-authoritative recovery)', () => {
	it('crash between step 1 (surface) and step 2 (release): reconcile from `main` converges to cleared + surfaced (never a dangling held lock over an already-surfaced item)', async () => {
		const {repo} = await seedWithActiveLock('alpha');
		// Simulate a crash BETWEEN step 1 and step 2 (surface landed, lock never
		// released) — the ordered transition's genuine crash window.
		await surfaceButLeaveLockHeld(
			repo,
			'alpha',
			'work/tasks/ready/alpha.md',
			'crash-between-steps',
		);

		const rec = await reconcileItemLockAgainstMain({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(rec.outcome).toBe('cleared-stale');
		// End state: sidecar + needsAnswers on main (durable), NO lock (cleared).
		expect(sidecarSurfacedOnArbiterMain(repo, 'alpha')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'alpha')).toBe(true);
		const lock = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock).toBeUndefined();
	});

	it('crash BEFORE step 1 (surface never landed): reconcile leaves the active lock in-flight (nothing to recover — the item is safe to re-claim after normal release)', async () => {
		// A held lock over an item whose surface commit never landed on main —
		// there is no `main`-authoritative surface to recover from, so reconcile
		// MUST leave the lock alone (it is a normal in-flight hold, not a
		// crash-window orphan). This is the false-positive fence.
		const {repo} = await seedWithActiveLock('alpha');
		const rec = await reconcileItemLockAgainstMain({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(rec.outcome).toBe('kept-in-flight');
		const lock = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock?.state).toBe('active');
	});
});
