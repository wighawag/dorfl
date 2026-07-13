import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {acquireTaskingLock, releaseTaskingLock} from '../src/tasking-lock.js';
import {performClaim} from '../src/claim-cas.js';
import {itemLockRef, listItemLocks, readItemLock} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	raceClone,
	racerEnv,
	type Scratch,
	fixtureFolderRel,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

let scratch: Scratch;

beforeEach(() => {
	scratch = makeScratch('dorfl-tasking-lock-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Does `<arbiter>/main` track `work/<folder>/<slug>.md`? (soft check). */
function trackedOnArbiter(cwd: string, folder: string, slug: string): boolean {
	run('git', ['fetch', '-q', 'arbiter'], cwd, {env: gitEnv()});
	return (
		run(
			'git',
			[
				'cat-file',
				'-e',
				`arbiter/main:work/${fixtureFolderRel(folder)}/${slug}.md`,
			],
			cwd,
			{env: gitEnv()},
		).status === 0
	);
}
const prdOnArbiter = (cwd: string, slug: string): boolean =>
	trackedOnArbiter(cwd, 'prd', slug);
const taskingFolderOnArbiter = (cwd: string, slug: string): boolean =>
	trackedOnArbiter(cwd, 'tasking', slug);
/** Does the arbiter HOLD the per-item lock ref for the spec `slug`? (MIGRATE
 * step: the tasking path now EMITs the `spec-<slug>` entry, not `prd-<slug>`.) */
function lockRefOnArbiter(arbiter: string, slug: string): boolean {
	const r = run(
		'git',
		['ls-remote', `file://${arbiter}`, itemLockRef(`spec-${slug}`)],
		scratch.root,
		{env: gitEnv()},
	);
	return r.status === 0 && r.stdout.trim() !== '';
}

/**
 * The tasking lock is the UNIFIED per-item lock now (task
 * `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`): the
 * `git mv work/specs/ready/ → work/tasking/` marker is RETIRED, so the prd body STAYS in
 * `work/specs/ready/` while it is being tasked (the lock is the `prd:<slug>` ref,
 * `action: task`). The durable `prd → prd-tasked` success move + the read-stability
 * stale check live at the integrate seam (`tasking.ts`), not in the lock.
 */

describe('acquireTaskingLock — happy path', () => {
	it('takes the prd:<slug> unified lock; the PRD body STAYS in prd/ (no tasking/ marker)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [], {
			specs: ['alpha'],
		});
		const result = await acquireTaskingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('acquired');
		// The unified lock (action: task) is held; the retired tasking/ marker is
		// never written; the body stays in prd/.
		expect(lockRefOnArbiter(arbiter, 'alpha')).toBe(true);
		expect(taskingFolderOnArbiter(repo, 'alpha')).toBe(false);
		expect(prdOnArbiter(repo, 'alpha')).toBe(true);
		const entry = await readItemLock({
			item: 'spec:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(entry?.action).toBe('task');
		expect(entry?.state).toBe('active');
	});

	it('returns the acquire-time lockedBlob (the prd/ body snapshot)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {specs: ['alpha']});
		const result = await acquireTaskingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		// The lockedBlob is the blob of work/specs/ready/alpha.md on the arbiter.
		const blob = run(
			'git',
			['rev-parse', 'arbiter/main:work/specs/ready/alpha.md'],
			repo,
			{env: gitEnv()},
		).stdout.trim();
		expect(result.lockedBlob).toBe(blob);
	});

	it('dry-run reports the lockable snapshot and does NOT take the lock', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [], {
			specs: ['alpha'],
		});
		const notes: string[] = [];
		const result = await acquireTaskingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			dryRun: true,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(result.exitCode).toBe(0);
		expect(notes.some((n) => n.includes('[dry-run]'))).toBe(true);
		expect(result.lockedBlob).toBeDefined();
		expect(lockRefOnArbiter(arbiter, 'alpha')).toBe(false);
		expect(prdOnArbiter(repo, 'alpha')).toBe(true);
	});
});

describe('acquireTaskingLock — not lockable (exit 2)', () => {
	it('returns "lost" when there is no such PRD', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {specs: ['alpha']});
		const result = await acquireTaskingLock({
			slug: 'nope',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(2);
		expect(result.outcome).toBe('lost');
	});

	it('returns "lost" when the PRD is already held (unified lock taken)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {specs: ['alpha']});
		const other = seeded.clone('other');
		const first = await acquireTaskingLock({
			slug: 'alpha',
			cwd: other,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(first.exitCode).toBe(0);
		const second = await acquireTaskingLock({
			slug: 'alpha',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(second.exitCode).toBe(2);
		expect(second.outcome).toBe('lost');
	});
});

describe('acquireTaskingLock — usage / env errors (exit 1)', () => {
	it('errors when the arbiter remote does not exist', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {specs: ['alpha']});
		const result = await acquireTaskingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'nope',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.message).toMatch(/no git remote named 'nope'/);
	});
});

describe('tasking-lock race — exactly one winner', () => {
	it('two simultaneous taskers ⇒ one acquires, the loser gets exit-2', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {specs: ['solo']});
		// Distinct committer identity per racer so the two lock commits get DISTINCT
		// shas (as two real taskers would) and the loser loses through the genuine
		// create-only ref CAS, not a fixture sha-collision. See racerEnv.
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');

		const [ra, rb] = await Promise.all([
			acquireTaskingLock({
				slug: 'solo',
				cwd: a,
				arbiter: 'arbiter',
				env: racerEnv('a'),
			}),
			acquireTaskingLock({
				slug: 'solo',
				cwd: b,
				arbiter: 'arbiter',
				env: racerEnv('b'),
			}),
		]);

		const acquired = [ra, rb].filter((r) => r.exitCode === 0);
		const lost = [ra, rb].filter((r) => r.exitCode === 2);
		expect(acquired).toHaveLength(1);
		expect(lost).toHaveLength(1);
		// The arbiter agrees: the lock is held exactly once; the prd never moved.
		expect(await listItemLocks(a, 'arbiter', gitEnv())).toEqual(['spec-solo']);
		expect(prdOnArbiter(a, 'solo')).toBe(true);
		expect(taskingFolderOnArbiter(a, 'solo')).toBe(false);
	});
});

describe('tasking∥claim exclusion on the SAME slug-namespace ref', () => {
	it('a held tasking lock and a build claim share the SAME prd: vs task: ref namespaces (no collision)', async () => {
		// A spec `dual` and a TASK `dual` are DISTINCT entries (`spec-dual` vs
		// `task-dual`), so a tasking lock on the spec and a build claim on the task
		// do NOT collide — they are different items. (MIGRATE step: the tasking path
		// EMITs the `spec-<slug>` entry now.)
		const seeded = seedRepoWithArbiter(scratch.root, ['dual'], {
			specs: ['dual'],
		});
		const tasking = await acquireTaskingLock({
			slug: 'dual',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(tasking.exitCode).toBe(0);
		const claim = await performClaim({
			slug: 'dual',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		// Both locks are held on DISTINCT refs.
		expect(lockRefOnArbiter(seeded.arbiter, 'dual')).toBe(true); // spec-dual
		const slugs = await listItemLocks(seeded.repo, 'arbiter', gitEnv());
		expect(slugs.sort()).toEqual(['spec-dual', 'task-dual']);
	});
});

describe('releaseTaskingLock — deletes the unified lock', () => {
	it('deletes the prd: lock ref on a clean release (exit 0); the PRD stays in prd/', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [], {
			specs: ['alpha'],
		});
		const acquired = await acquireTaskingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(acquired.exitCode).toBe(0);
		const result = await releaseTaskingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			lockedBlob: acquired.lockedBlob,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('released');
		expect(lockRefOnArbiter(arbiter, 'alpha')).toBe(false);
		expect(prdOnArbiter(repo, 'alpha')).toBe(true);
	});

	it('an already-absent lock is an idempotent "released"', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {specs: ['alpha']});
		const result = await releaseTaskingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('released');
	});
});

describe('releaseTaskingLock — routeToNeedsAttention surfaces + releases (PR-2b)', () => {
	it('surfaces the spec on <arbiter>/main (sidecar + needsAnswers) THEN releases the tasking lock', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [], {
			specs: ['alpha'],
		});
		const acquired = await acquireTaskingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(acquired.exitCode).toBe(0);
		const result = await releaseTaskingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			lockedBlob: acquired.lockedBlob,
			routeToNeedsAttention: {reason: 'decomposition unclear: what is X?'},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('released');
		// PR-2b (spec `surface-stuck-as-questions-and-retire-stuck-lock-state`,
		// decision #1): the tasking bounce SURFACES the spec on `<arbiter>/main` as
		// a stuck-kind sidecar + `needsAnswers:true` on the spec body in ONE commit,
		// THEN RELEASES the tasking lock. The spec body stays where it lives (D1
		// probe finds it in `specs/ready/` or `specs/proposed/`).
		expect(lockRefOnArbiter(arbiter, 'alpha')).toBe(false);
		expect(trackedOnArbiter(repo, 'needs-attention', 'alpha')).toBe(false);
		expect(prdOnArbiter(repo, 'alpha')).toBe(true);
		// The reason lives on the surfaced sidecar envelope's context on
		// `<arbiter>/main`.
		run('git', ['fetch', '-q', 'arbiter'], repo, {env: gitEnv()});
		const sidecar = run(
			'git',
			['show', 'arbiter/main:work/questions/spec-alpha.md'],
			repo,
			{env: gitEnv()},
		).stdout;
		expect(sidecar).toMatch(/decomposition unclear/);
		const entry = await readItemLock({
			item: 'spec:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(entry).toBeUndefined();
	});

	it('returns "lost" when there is no held lock to mark stuck', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {specs: ['alpha']});
		const result = await releaseTaskingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			routeToNeedsAttention: {reason: 'x'},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(2);
		expect(result.outcome).toBe('lost');
	});
});
