import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync} from 'node:fs';
import {
	promoteFromPreBacklog,
	promoteFromPrePrd,
} from '../src/needs-attention.js';
import {
	acquireItemLock,
	releaseItemLock,
	readItemLock,
} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	raceClone,
	racerEnv,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * F3b — `promote` takes the per-item `advancing` lock for its CAS window (task
 * `f3b-promote-takes-per-item-advancing-lock`, PRD
 * `staging-surface-and-apply-promote-safety`).
 *
 * `promote` and `apply` both run with `action: advance` on the SAME unified
 * per-item lock ref (`refs/dorfl/lock/<entry>`), so a promote and an apply
 * on the SAME item are mutually exclusive BY CONSTRUCTION (the second acquirer
 * loses the create-only ref CAS). These tests prove that:
 *
 *   (a) when an apply-style `advance` hold is already held on the item, a
 *       concurrent `promoteFromPreBacklog` LOSES CLEAN — no commit on `main`,
 *       the staged file is untouched, and the holder's lock is unmoved.
 *   (b) the prd-symmetric case (`promoteFromPrePrd` against a held
 *       `prd:<slug>` advance lock) behaves the same — the prd promote path
 *       is covered too per PRD q4 (the prds/proposed → prds/ready promote
 *       is symmetric with tasks/backlog → tasks/ready).
 *   (c) the lock is RELEASED on the happy path too: after a successful promote
 *       there is no held lock left behind for the next transition.
 *
 * Throwaway `--bare file://` arbiter, the house pattern (`seedRepoWithArbiter`).
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('promote-takes-per-item-lock-');
});
afterEach(() => {
	scratch.cleanup();
});

function onArbiterMain(repo: string, path: string): boolean {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return (
		run('git', ['cat-file', '-e', `${ARBITER}/main:${path}`], repo, {
			env: gitEnv(),
		}).status === 0
	);
}

/** Seed a staged task file at `work/tasks/backlog/<slug>.md` on the arbiter. */
function seedStagedTask(repo: string, slug: string): void {
	const dir = join(repo, 'work', 'tasks', 'backlog');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, `${slug}.md`),
		`---\nslug: ${slug}\nprd: it\n---\n\n## Prompt\n\n> ${slug}\n`,
	);
	run('git', ['add', '-A'], repo, {env: gitEnv()});
	run('git', ['commit', '-q', '-m', `stage ${slug}`], repo, {env: gitEnv()});
	run('git', ['push', '-q', ARBITER, 'main'], repo, {env: gitEnv()});
}

/** Seed a staged prd file at `work/specs/proposed/<slug>.md` on the arbiter. */
function seedStagedPrd(repo: string, slug: string): void {
	const dir = join(repo, 'work', 'specs', 'proposed');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, `${slug}.md`),
		`---\nslug: ${slug}\n---\n\n## Problem Statement\n\nprd ${slug}\n`,
	);
	run('git', ['add', '-A'], repo, {env: gitEnv()});
	run('git', ['commit', '-q', '-m', `stage prd ${slug}`], repo, {
		env: gitEnv(),
	});
	run('git', ['push', '-q', ARBITER, 'main'], repo, {env: gitEnv()});
}

describe('promote takes the per-item advancing lock — apply × promote mutual exclusion', () => {
	it('task promote LOSES CLEAN when a concurrent advance hold is already held on the same item', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		seedStagedTask(seeded.repo, 'race-me');

		// A concurrent "apply" holds the advance lock first (modelling an in-flight
		// tree-less advance rung — apply takes the SAME `task-race-me` ref under
		// `action: advance` via `advancing-lock.ts`).
		const holder = raceClone(seeded, 'apply');
		const held = await acquireItemLock({
			item: 'task:race-me',
			action: 'advance',
			cwd: holder,
			arbiter: ARBITER,
			env: racerEnv('apply'),
		});
		expect(held.outcome).toBe('acquired');

		// The promoter contends on the SAME ref and LOSES CLEAN: no main move, the
		// staged file is byte-for-byte unchanged, and the loser surfaces a clear
		// reason (mirrors claim-cas loss semantics).
		const promoter = raceClone(seeded, 'promote');
		const result = await promoteFromPreBacklog({
			slug: 'race-me',
			cwd: promoter,
			arbiter: ARBITER,
			env: racerEnv('promote'),
		});
		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(
			/per-item lock|already locked|implement\/task\/advance/i,
		);
		// The staged file is still in pre-backlog/staging (no split-brain on main).
		expect(onArbiterMain(seeded.repo, 'work/tasks/backlog/race-me.md')).toBe(
			true,
		);
		expect(onArbiterMain(seeded.repo, 'work/tasks/ready/race-me.md')).toBe(
			false,
		);

		// The holder's lock is UNMOVED (still the original `advance` active hold).
		const after = await readItemLock({
			item: 'task:race-me',
			cwd: holder,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(after?.action).toBe('advance');
		expect(after?.state).toBe('active');

		await releaseItemLock({
			item: 'task:race-me',
			cwd: holder,
			arbiter: ARBITER,
			env: racerEnv('apply'),
		});
	});

	it('prd promote LOSES CLEAN when a concurrent advance hold is already held on the same prd', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		seedStagedPrd(seeded.repo, 'prd-race');

		// Apply-style advance hold on `prd:prd-race` (the prd lock entry is
		// distinct from a task with the same slug, via `lockEntryFor`'s
		// `<type>-<slug>` encoding).
		const holder = raceClone(seeded, 'apply');
		const held = await acquireItemLock({
			item: 'prd:prd-race',
			action: 'advance',
			cwd: holder,
			arbiter: ARBITER,
			env: racerEnv('apply'),
		});
		expect(held.outcome).toBe('acquired');

		const promoter = raceClone(seeded, 'promote');
		const result = await promoteFromPrePrd({
			slug: 'prd-race',
			cwd: promoter,
			arbiter: ARBITER,
			env: racerEnv('promote'),
		});
		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(
			/per-item lock|already locked|implement\/task\/advance/i,
		);
		// The staged prd is unmoved on the arbiter.
		expect(onArbiterMain(seeded.repo, 'work/specs/proposed/prd-race.md')).toBe(
			true,
		);
		expect(onArbiterMain(seeded.repo, 'work/specs/ready/prd-race.md')).toBe(
			false,
		);

		await releaseItemLock({
			item: 'prd:prd-race',
			cwd: holder,
			arbiter: ARBITER,
			env: racerEnv('apply'),
		});
	});

	it('a successful task promote RELEASES the per-item lock (no orphaned advance hold)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		seedStagedTask(seeded.repo, 'happy');

		const result = await promoteFromPreBacklog({
			slug: 'happy',
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// The body landed in the pool, and the lock is GONE (no leftover `advance`
		// hold blocking a subsequent claim/apply on the same item).
		expect(onArbiterMain(seeded.repo, 'work/tasks/ready/happy.md')).toBe(true);
		expect(onArbiterMain(seeded.repo, 'work/tasks/backlog/happy.md')).toBe(
			false,
		);
		const after = await readItemLock({
			item: 'task:happy',
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(after).toBeUndefined();
	});

	it('a successful prd promote RELEASES the per-item lock (symmetric)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		seedStagedPrd(seeded.repo, 'happy-prd');

		const result = await promoteFromPrePrd({
			slug: 'happy-prd',
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		expect(onArbiterMain(seeded.repo, 'work/specs/ready/happy-prd.md')).toBe(
			true,
		);
		expect(onArbiterMain(seeded.repo, 'work/specs/proposed/happy-prd.md')).toBe(
			false,
		);
		const after = await readItemLock({
			item: 'prd:happy-prd',
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(after).toBeUndefined();
	});

	it('after a task promote holds the lock, a concurrent advance acquire LOSES (the symmetric direction)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		seedStagedTask(seeded.repo, 'sym');

		// Promote pre-acquires its CAS-window lock (the same path the production
		// promote runs through internally). A concurrent apply-style advance acquire
		// on the SAME item LOSES the create-only ref CAS — proving the mutual
		// exclusion holds in BOTH directions (promote-then-apply, not just
		// apply-then-promote).
		const promoter = raceClone(seeded, 'promote');
		const held = await acquireItemLock({
			item: 'task:sym',
			action: 'advance',
			cwd: promoter,
			arbiter: ARBITER,
			env: racerEnv('promote'),
		});
		expect(held.outcome).toBe('acquired');

		const applier = raceClone(seeded, 'apply');
		const apply = await acquireItemLock({
			item: 'task:sym',
			action: 'advance',
			cwd: applier,
			arbiter: ARBITER,
			env: racerEnv('apply'),
		});
		expect(apply.outcome).toBe('lost');

		await releaseItemLock({
			item: 'task:sym',
			cwd: promoter,
			arbiter: ARBITER,
			env: racerEnv('promote'),
		});
	});
});
