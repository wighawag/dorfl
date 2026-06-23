import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {
	acquireItemLock,
	markStuckItemLock,
	reapStaleItemLocks,
	reapReportNeedsAttention,
	formatReapReport,
	listItemLocks,
	itemLockRef,
} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	type Scratch,
	fixtureFolderRel,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * Regression for `gc-ledger-reap-stale-locks-opt-in-flag` (PRD
 * `ledger-status-per-item-lock-refs` US #14): the OPT-IN
 * `gc --ledger --reap-stale-locks` SWEEP that auto-clears stranded TERMINAL locks
 * (a held `active` lock whose item is already terminal on `<arbiter>/main` — the
 * `cleared-stale` class) via the SAME leased delete `release-lock` / the recovery
 * use, while the DEFAULT `gc --ledger` stays report-only.
 *
 *   - the reaper CLEARS a terminal-on-main + active lock (the `cleared-stale` class);
 *   - it NEVER touches a `kept-stuck` (terminal + stuck) or a `kept-in-flight`
 *     (active + non-terminal) lock, even with the flag;
 *   - a concurrent change to a lock ref makes its leased delete REJECT (reported,
 *     `lost`), never `--force`;
 *   - it covers all four terminals (task done/cancelled, brief tasked/dropped);
 *   - the default report-only path (`reportItemLocks`) still deletes nothing (proven
 *     in `release-lock-and-gc-stuck-report.test.ts`).
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-gc-reap-');
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
 * clone (a durable terminal record landing without the lock release — the crash
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
	const dir = join(dest, 'work', fixtureFolderRel(folder));
	mkdirSync(dir, {recursive: true});
	writeFileSync(join(dir, `${slug}.md`), `${folder}: ${slug}\n`);
	run('git', ['add', '-A'], dest, {env});
	run('git', ['commit', '-q', '-m', `${folder}: ${slug}`], dest, {env});
	run('git', ['push', '-q', 'origin', `seed/${slug}:main`], dest, {env});
	rmSync(dest, {recursive: true, force: true});
}

describe('gc --ledger --reap-stale-locks — clears the cleared-stale class only', () => {
	it('reaps a terminal-on-main + active lock via the shared leased delete', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['stale']);
		await acquireItemLock({
			item: 'task:stale',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		// The crash between the durable done-move and the lock release: the item is
		// now terminal on main (work/tasks/done/) but the active lock lingers.
		seedTerminalOnArbiter(arbiter, 'done', 'stale');
		expect(lockRefOnArbiter(arbiter, 'task-stale')).toBe(true);

		const reap = await reapStaleItemLocks(repo, ARBITER, gitEnv());

		expect(reap.reaped).toBe(1);
		expect(reap.entries).toHaveLength(1);
		expect(reap.entries[0].outcome).toBe('reaped');
		expect(reap.entries[0].lock.entry).toBe('task-stale');
		// SWEPT: the leased delete removed the ref.
		expect(lockRefOnArbiter(arbiter, 'task-stale')).toBe(false);
		// A clean sweep (only a reaped stale lock) does NOT need attention (exit 0).
		expect(reapReportNeedsAttention(reap)).toBe(false);
	});

	it('NEVER reaps a kept-stuck lock (terminal + stuck), even with the flag', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['bounced']);
		await acquireItemLock({
			item: 'task:bounced',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		await markStuckItemLock({
			item: 'task:bounced',
			reason: 'rebase-conflict bounce of a just-completed item',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		// done + stuck co-exist (US #10).
		seedTerminalOnArbiter(arbiter, 'done', 'bounced');

		const reap = await reapStaleItemLocks(repo, ARBITER, gitEnv());

		expect(reap.reaped).toBe(0);
		expect(reap.entries).toHaveLength(1);
		expect(reap.entries[0].outcome).toBe('kept-stuck');
		// UNTOUCHED — the stuck lock wins the human's attention.
		expect(lockRefOnArbiter(arbiter, 'task-bounced')).toBe(true);
		// A stuck lock that survives the sweep still needs attention (exit 1).
		expect(reapReportNeedsAttention(reap)).toBe(true);
	});

	it('NEVER reaps a kept-in-flight lock (active + non-terminal), even with the flag', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['live']);
		await acquireItemLock({
			item: 'task:live',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		// No terminal record on main — the item is genuinely in flight.

		const reap = await reapStaleItemLocks(repo, ARBITER, gitEnv());

		expect(reap.reaped).toBe(0);
		expect(reap.entries).toHaveLength(1);
		expect(reap.entries[0].outcome).toBe('kept-in-flight');
		// UNTOUCHED — the lock is doing its job.
		expect(lockRefOnArbiter(arbiter, 'task-live')).toBe(true);
		// A healthy in-flight hold does NOT need attention (exit 0).
		expect(reapReportNeedsAttention(reap)).toBe(false);
	});

	it('sweeps a MIX: reaps the stale, keeps the stuck + the in-flight in one pass', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [
			'stale',
			'stuck',
			'flight',
		]);
		for (const slug of ['stale', 'stuck', 'flight']) {
			await acquireItemLock({
				item: `task:${slug}`,
				action: 'implement',
				cwd: repo,
				arbiter: ARBITER,
				env: gitEnv(),
			});
		}
		// stale: terminal + active. stuck: terminal + stuck. flight: active, no terminal.
		seedTerminalOnArbiter(arbiter, 'done', 'stale');
		await markStuckItemLock({
			item: 'task:stuck',
			reason: 'human attention please',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		seedTerminalOnArbiter(arbiter, 'done', 'stuck');

		const reap = await reapStaleItemLocks(repo, ARBITER, gitEnv());

		expect(reap.reaped).toBe(1);
		expect(reap.kept).toBe(2);
		// Only the stale lock is gone; the stuck + the in-flight survive.
		expect(lockRefOnArbiter(arbiter, 'task-stale')).toBe(false);
		expect(lockRefOnArbiter(arbiter, 'task-stuck')).toBe(true);
		expect(lockRefOnArbiter(arbiter, 'task-flight')).toBe(true);
		// The surviving stuck lock means the sweep still needs attention (exit 1).
		expect(reapReportNeedsAttention(reap)).toBe(true);
		const text = formatReapReport(reap).join('\n');
		expect(text).toMatch(/reaped 1/);
	});

	it('covers all four terminals (task done/cancelled, brief tasked/dropped)', async () => {
		const cases: Array<{
			item: string;
			action: 'implement' | 'task';
			folder: string;
			entry: string;
		}> = [
			{
				item: 'task:t-done',
				action: 'implement',
				folder: 'done',
				entry: 'task-t-done',
			},
			{
				item: 'task:t-cancelled',
				action: 'implement',
				folder: 'cancelled',
				entry: 'task-t-cancelled',
			},
			{
				item: 'brief:b-tasked',
				action: 'task',
				folder: 'briefs-tasked',
				entry: 'brief-b-tasked',
			},
			{
				item: 'brief:b-dropped',
				action: 'task',
				folder: 'briefs-dropped',
				entry: 'brief-b-dropped',
			},
		];
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['t-done']);
		for (const c of cases) {
			await acquireItemLock({
				item: c.item,
				action: c.action,
				cwd: repo,
				arbiter: ARBITER,
				env: gitEnv(),
			});
			seedTerminalOnArbiter(arbiter, c.folder, c.item.split(':')[1]);
		}

		const reap = await reapStaleItemLocks(repo, ARBITER, gitEnv());

		expect(reap.reaped).toBe(4);
		for (const c of cases) {
			expect(lockRefOnArbiter(arbiter, c.entry)).toBe(false);
		}
		expect(reapReportNeedsAttention(reap)).toBe(false);
	});

	it('an EMPTY lock set is a clean no-op sweep (no attention, silent)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['none']);
		const reap = await reapStaleItemLocks(repo, ARBITER, gitEnv());
		expect(reap.entries).toEqual([]);
		expect(reap.reaped).toBe(0);
		expect(reapReportNeedsAttention(reap)).toBe(false);
		expect(formatReapReport(reap)).toEqual([]);
		expect(await listItemLocks(repo, ARBITER, gitEnv())).toEqual([]);
	});
});

describe('gc --ledger --reap-stale-locks — a lost lease is REPORTED, never --force', () => {
	it('two concurrent reapers on the same stale lock: one reaps, the other sees the BENIGN already-reaped (no-lock); neither needs attention', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['raced']);
		const {arbiter} = seeded;
		// A single held active lock made terminal-on-main (a stale lock).
		await acquireItemLock({
			item: 'task:raced',
			action: 'implement',
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		seedTerminalOnArbiter(arbiter, 'done', 'raced');

		// Two independent clones each run the sweep against the SAME arbiter ref.
		// The leased delete (`--force-with-lease`) makes the loser's clear path
		// observe the ref already GONE on the re-read (`no-lock`) — the BENIGN
		// already-reaped outcome — never a blind --force, never a spurious `lost`.
		const a = seeded.clone('reaper-a');
		const b = seeded.clone('reaper-b');
		const [ra, rb] = await Promise.all([
			reapStaleItemLocks(a, ARBITER, gitEnv()),
			reapStaleItemLocks(b, ARBITER, gitEnv()),
		]);

		const reaped = ra.reaped + rb.reaped;
		const alreadyReaped = ra.alreadyReaped + rb.alreadyReaped;
		const lost = ra.lost + rb.lost;
		// Exactly one reaper won; the other saw `no-lock` and recorded the BENIGN
		// already-reaped outcome. NEITHER counted a `lost` lease — a clean
		// concurrent double-reap of the SAME stale lock is not a race we lost.
		expect(reaped).toBe(1);
		expect(alreadyReaped).toBe(1);
		expect(lost).toBe(0);
		// One reaper has a single `reaped`, the other a single `already-reaped`.
		const outcomesA = ra.entries.map((e) => e.outcome);
		const outcomesB = rb.entries.map((e) => e.outcome);
		expect([outcomesA, outcomesB].sort()).toEqual(
			[['already-reaped'], ['reaped']].sort(),
		);
		// NEITHER report needs attention — both processes exit 0. This is the
		// exit-code contract: an already-reaped (`no-lock`) is the DESIRED end
		// state, not a lost lease.
		expect(reapReportNeedsAttention(ra)).toBe(false);
		expect(reapReportNeedsAttention(rb)).toBe(false);
		// The ref is gone exactly once on the ARBITER (the authoritative check — a
		// loser's clone may still hold a stale LOCAL tracking ref, since a non-pruning
		// fetch does not drop a deleted remote ref; that is git, not the reaper).
		expect(lockRefOnArbiter(arbiter, 'task-raced')).toBe(false);
		// The benign already-reaped tag prints distinctly (not `[kept]`), so a
		// reaped-by-other lock is never misreported as one the reaper left behind.
		const loserText = formatReapReport(ra.alreadyReaped === 1 ? ra : rb).join(
			'\n',
		);
		expect(loserText).toMatch(/\[already\]/);
		expect(loserText).toMatch(/already reaped by another sweep/);
	});

	it('a genuine `lost` outcome (lease genuinely rejected / error) STILL needs attention — the real-race path is not collapsed into the benign one', () => {
		// The two paths must stay SEPARABLE: `already-reaped` is benign
		// (`reapReportNeedsAttention` false), `lost`/`error` is the real race
		// (true). Constructed from a synthetic report — reproducing a deterministic
		// leased-delete REJECTION end-to-end requires a TOCTOU window inside
		// `reconcileItemLockAgainstMain` that is not exposed for testing, so we
		// pin the exit-code contract at the predicate boundary instead.
		const lostOnly: import('../src/item-lock.js').ReapReport = {
			entries: [
				{
					lock: {
						entry: 'task-raced',
						action: 'implement',
						state: 'active',
						holder: 'reaper-a',
						since: '2026-06-20T00:00:00Z',
						reason: '',
					},
					ref: 'refs/agent-runner/lock/task-raced',
					outcome: 'lost',
					message:
						"stale-lock clear for 'task-raced' rejected (changed concurrently)",
				},
			],
			reaped: 0,
			alreadyReaped: 0,
			kept: 0,
			lost: 1,
		};
		expect(reapReportNeedsAttention(lostOnly)).toBe(true);

		const alreadyOnly: import('../src/item-lock.js').ReapReport = {
			entries: [
				{
					lock: {
						entry: 'task-raced',
						action: 'implement',
						state: 'active',
						holder: 'reaper-b',
						since: '2026-06-20T00:00:00Z',
						reason: '',
					},
					ref: 'refs/agent-runner/lock/task-raced',
					outcome: 'already-reaped',
					message: "'task-raced' has no lock to reconcile",
				},
			],
			reaped: 0,
			alreadyReaped: 1,
			kept: 0,
			lost: 0,
		};
		expect(reapReportNeedsAttention(alreadyOnly)).toBe(false);
	});
});
