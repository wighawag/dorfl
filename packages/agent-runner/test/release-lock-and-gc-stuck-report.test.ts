import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {
	acquireItemLock,
	releaseItemLock,
	releaseHeldItemLock,
	markStuckItemLock,
	listItemLocks,
	reportItemLocks,
	formatItemLockReport,
	classifyItemLockAgainstMain,
	itemFromLockEntry,
	itemLockRef,
} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * Regression for `release-lock-verb-and-gc-stuck-report` (PRD
 * `ledger-status-per-item-lock-refs` US #12/#13/#14): generalising the landed
 * advancing-only human-recovery surface (`release-advancing` + the
 * `gc --ledger` advancing-marker report) to the UNIFIED per-item lock.
 *
 *   - `release-lock <item>` (via `releaseItemLock`) clears a NAMED unified lock by
 *     DELETING the ref; idempotent; an absent ref = "all locks released".
 *   - `reportItemLocks` lists lingering locks (held + stuck) with holder/since/
 *     reason and a read-only `main`-reconciliation classification, and CLEARS
 *     nothing (no auto-sweep, no heartbeat).
 *   - the report wires the read-only twin of `reconcileItemLockAgainstMain`
 *     (`classifyItemLockAgainstMain`) to distinguish a held/stuck lock from a
 *     stale-active lock over a terminal-on-`main` item WITHOUT clearing.
 *   - an ABSENT lock-ref namespace reads as "no locks held" ([]).
 *   - a runner whose OWN lock VANISHED mid-build detects it on release
 *     (`releaseHeldItemLock` → `vanished`) and aborts rather than clean-releasing.
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-release-lock-gc-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Does the arbiter currently HOLD the per-item lock ref for `entry`? */
function lockRefOnArbiter(arbiter: string, entry: string): boolean {
	const r = run(
		'git',
		['ls-remote', `file://${arbiter}`, itemLockRef(entry)],
		scratch.root,
		{env: gitEnv()},
	);
	return r.status === 0 && r.stdout.trim() !== '';
}

/** Push a `work/<folder>/<slug>.md` straight onto `<arbiter>/main` via a throwaway
 * clone (a durable terminal record landing without the lock release — a crash
 * BETWEEN the main move and the lock release). */
function seedTerminalOnArbiter(
	arbiter: string,
	folder: string,
	slug: string,
): void {
	const dest = join(scratch.root, `seed-term-${folder}-${slug}`);
	const env = gitEnv();
	run('git', ['clone', '-q', `file://${arbiter}`, dest], scratch.root, {env});
	run('git', ['checkout', '-q', '-B', `seed/${slug}`, 'origin/main'], dest, {
		env,
	});
	const dir = join(dest, 'work', folder);
	mkdirSync(dir, {recursive: true});
	writeFileSync(join(dir, `${slug}.md`), `${folder}: ${slug}\n`);
	run('git', ['add', '-A'], dest, {env});
	run('git', ['commit', '-q', '-m', `${folder}: ${slug}`], dest, {env});
	run('git', ['push', '-q', 'origin', `seed/${slug}:main`], dest, {env});
	rmSync(dest, {recursive: true, force: true});
}

describe('release-lock — clears a NAMED unified lock (generalises release-advancing)', () => {
	it('clears a named lock entry by DELETING the ref (covers US #14)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['stuck']);
		// Plant the lock by running the normal acquire path — the shape a crashed
		// build/slice/advance leaves behind (a held ref with no matching release).
		const acq = await acquireItemLock({
			item: 'slice:stuck',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(acq.outcome).toBe('acquired');
		expect(lockRefOnArbiter(arbiter, 'slice-stuck')).toBe(true);

		// The human-invoked release names + clears the lock (deleting the ref).
		const rel = await releaseItemLock({
			item: 'slice:stuck',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(rel.outcome).toBe('released');
		expect(rel.entry).toBe('slice-stuck');
		// SELF-CLEANING: release DELETED the ref (the lock set is now empty).
		expect(lockRefOnArbiter(arbiter, 'slice-stuck')).toBe(false);

		// The item itself was NEVER moved — the borrow is a lock, not a transition.
		run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
		const inBacklog = run(
			'git',
			['cat-file', '-e', `${ARBITER}/main:work/backlog/stuck.md`],
			repo,
			{env: gitEnv()},
		);
		expect(inBacklog.status).toBe(0);
	});

	it('is IDEMPOTENT: a re-run on an already-cleared lock is not-held (exit-0 "nothing to clear")', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['twice']);
		await acquireItemLock({
			item: 'slice:twice',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		const first = await releaseItemLock({
			item: 'slice:twice',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(first.outcome).toBe('released');
		// The second release finds the ref already absent — a clean idempotent
		// no-op the CLI maps to exit-0 "all locks released, recoverable".
		const second = await releaseItemLock({
			item: 'slice:twice',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(second.outcome).toBe('not-held');
		expect(second.entry).toBe('slice-twice');
	});

	it('the suggested item form round-trips through the identity seam (copy-pasteable hint)', () => {
		// The report suggests `release-lock <item>`; the item form must be the SAME
		// the lock API accepts (the inverse of lockEntryFor for the known namespaces).
		expect(itemFromLockEntry('slice-foo')).toBe('slice:foo');
		expect(itemFromLockEntry('prd-bar')).toBe('prd:bar');
		expect(itemFromLockEntry('observation-baz')).toBe('observation:baz');
	});
});

describe('gc --ledger stuck-lock report — REPORTS lingering locks, NEVER clears', () => {
	it('lists held + stuck locks with holder/since/reason, and does NOT clear them', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [
			'building',
			'jammed',
		]);
		// One active (in-progress) lock and one stuck (needs-attention) lock.
		await acquireItemLock({
			item: 'slice:building',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			holder: 'alice',
			env: gitEnv(),
		});
		await acquireItemLock({
			item: 'slice:jammed',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			holder: 'bob',
			env: gitEnv(),
		});
		const stuck = await markStuckItemLock({
			item: 'slice:jammed',
			reason: 'gate failed twice',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(stuck.outcome).toBe('transitioned');

		const report = await reportItemLocks(repo, ARBITER, gitEnv());
		expect(report.locks.map((l) => l.lock.entry).sort()).toEqual([
			'slice-building',
			'slice-jammed',
		]);
		const jammed = report.locks.find((l) => l.lock.entry === 'slice-jammed');
		expect(jammed?.lock.state).toBe('stuck');
		expect(jammed?.lock.reason).toBe('gate failed twice');
		expect(jammed?.lock.holder).toBe('bob');
		const building = report.locks.find(
			(l) => l.lock.entry === 'slice-building',
		);
		expect(building?.lock.state).toBe('active');
		expect(building?.lock.holder).toBe('alice');

		// CRITICAL: the report did NOT clear anything (no auto-sweep, no heartbeat).
		expect(lockRefOnArbiter(arbiter, 'slice-building')).toBe(true);
		expect(lockRefOnArbiter(arbiter, 'slice-jammed')).toBe(true);

		const lines = formatItemLockReport(report);
		const text = lines.join('\n');
		expect(text).toMatch(/Per-item locks: 2 lock\(s\)/);
		expect(text).toMatch(/no automatic sweep/);
		expect(text).toMatch(/holder: bob/);
		expect(text).toMatch(/reason: gate failed twice/);
		// The pointer names the canonical item form (copy-pasteable).
		expect(text).toMatch(/agent-runner release-lock slice:jammed/);
		expect(text).toMatch(/never --force/);
	});

	it('an EMPTY lock set is a clean report (no lock section)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['idle']);
		const report = await reportItemLocks(repo, ARBITER, gitEnv());
		expect(report.locks).toEqual([]);
		expect(formatItemLockReport(report)).toEqual([]);
	});

	it('classifies a held + non-terminal lock as in-flight (left untouched)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['live']);
		await acquireItemLock({
			item: 'slice:live',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		const report = await reportItemLocks(repo, ARBITER, gitEnv());
		expect(report.locks).toHaveLength(1);
		expect(report.locks[0].reconcile).toBe('kept-in-flight');
		expect(lockRefOnArbiter(arbiter, 'slice-live')).toBe(true);
	});

	it('wires reconcile (read-only): a STALE-active lock over a terminal-on-main item is reported "reconcilable" but NOT cleared', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['done-ish']);
		await acquireItemLock({
			item: 'slice:done-ish',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		// Simulate the crash between the durable main-move and the lock release: the
		// item is now terminal on main (work/done/) but the active lock lingers.
		seedTerminalOnArbiter(arbiter, 'done', 'done-ish');

		// The read-only classifier names it as stale (cleared-stale-eligible) but
		// MUST NOT clear it (the report's no-auto-sweep contract).
		const verdict = await classifyItemLockAgainstMain({
			item: 'slice:done-ish',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(verdict.outcome).toBe('cleared-stale');
		expect(verdict.terminalOnMain).toBe(true);
		// The lock is STILL held — classification did not delete the ref.
		expect(lockRefOnArbiter(arbiter, 'slice-done-ish')).toBe(true);

		const report = await reportItemLocks(repo, ARBITER, gitEnv());
		expect(report.locks).toHaveLength(1);
		expect(report.locks[0].reconcile).toBe('cleared-stale');
		// Reported, not swept.
		expect(lockRefOnArbiter(arbiter, 'slice-done-ish')).toBe(true);
		const text = formatItemLockReport(report).join('\n');
		expect(text).toMatch(/STALE/);
		expect(text).toMatch(/NOT auto-cleared/);
	});

	it('a STUCK lock over a terminal-on-main item is kept for human attention (done+stuck co-exist)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['bounced']);
		await acquireItemLock({
			item: 'slice:bounced',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		await markStuckItemLock({
			item: 'slice:bounced',
			reason: 'rebase-conflict bounce of a just-completed item',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		seedTerminalOnArbiter(arbiter, 'done', 'bounced');

		const report = await reportItemLocks(repo, ARBITER, gitEnv());
		expect(report.locks).toHaveLength(1);
		expect(report.locks[0].reconcile).toBe('kept-stuck');
		// Never cleared by the report.
		expect(lockRefOnArbiter(arbiter, 'slice-bounced')).toBe(true);
	});
});

describe('absent lock ref = "no locks held" ([]) — deletion is recoverable', () => {
	it('an absent lock-ref namespace reads as the empty list (all locks released)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['safe']);
		// No lock ever acquired — the namespace is absent.
		expect(await listItemLocks(repo, ARBITER, gitEnv())).toEqual([]);
		const report = await reportItemLocks(repo, ARBITER, gitEnv());
		expect(report.locks).toEqual([]);
	});

	it('deleting the lock ref(s) leaves the work safe on main (the item never moved)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['recoverable']);
		await acquireItemLock({
			item: 'slice:recoverable',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		// Delete the lock ref (the accidental-deletion / release scenario).
		await releaseItemLock({
			item: 'slice:recoverable',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		// "All locks released" — and the body is still safe on main (never moved).
		expect(await listItemLocks(repo, ARBITER, gitEnv())).toEqual([]);
		run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
		expect(
			run(
				'git',
				['cat-file', '-e', `${ARBITER}/main:work/backlog/recoverable.md`],
				repo,
				{env: gitEnv()},
			).status,
		).toBe(0);
	});
});

describe('vanished-own-lock — a held runner detects the missing ref and aborts', () => {
	it('releaseHeldItemLock returns `vanished` (not a clean `released`) when our own ref is gone', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['midbuild']);
		// The runner acquires + HOLDS the lock (in-flight build).
		const acq = await acquireItemLock({
			item: 'slice:midbuild',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(acq.outcome).toBe('acquired');

		// Mid-build, someone else clears the lock out from under us (a human
		// `release-lock`, or a recovery/gc) — our own ref VANISHES.
		await releaseItemLock({
			item: 'slice:midbuild',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lockRefOnArbiter(arbiter, 'slice-midbuild')).toBe(false);

		// The held runner's guarded release DETECTS the missing ref and reports
		// `vanished` (an abort / needs-attention signal), NOT a silent clean
		// `released` — its hold was lost mid-build, so the exclusion it relied on
		// was not in force.
		const rel = await releaseHeldItemLock({
			item: 'slice:midbuild',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(rel.outcome).toBe('vanished');
		expect(rel.entry).toBe('slice-midbuild');
		expect(rel.message).toMatch(/VANISHED/);
	});

	it('a held runner whose lock is still present releases cleanly (the happy path)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['cleanfinish']);
		await acquireItemLock({
			item: 'slice:cleanfinish',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		const rel = await releaseHeldItemLock({
			item: 'slice:cleanfinish',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(rel.outcome).toBe('released');
		expect(lockRefOnArbiter(arbiter, 'slice-cleanfinish')).toBe(false);
	});
});
