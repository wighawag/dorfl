import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {readFileSync, writeFileSync} from 'node:fs';
import {acquireSlicingLock, releaseSlicingLock} from '../src/slicing-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	prdFile,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

let scratch: Scratch;

beforeEach(() => {
	scratch = makeScratch('agent-runner-slicing-lock-');
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
			['cat-file', '-e', `arbiter/main:work/${folder}/${slug}.md`],
			cwd,
			{env: gitEnv()},
		).status === 0
	);
}
const prdOnArbiter = (cwd: string, slug: string): boolean =>
	trackedOnArbiter(cwd, 'prd', slug);
const slicingOnArbiter = (cwd: string, slug: string): boolean =>
	trackedOnArbiter(cwd, 'slicing', slug);

describe('acquireSlicingLock — happy path', () => {
	it('moves the PRD prd/ -> slicing/ on the arbiter (exit 0)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		const result = await acquireSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('acquired');
		expect(slicingOnArbiter(repo, 'alpha')).toBe(true);
		expect(prdOnArbiter(repo, 'alpha')).toBe(false);
	});

	it('uses a lock branch (slicing/<slug>) distinct from build claims', async () => {
		// The branch name must not be claim/<slug> or work/<slug>; we assert the
		// lock branch is cleaned up and no claim/work branch was created.
		const {repo} = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		await acquireSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(gitIn(['branch', '--list', 'slicing/alpha'], repo).trim()).toBe('');
		expect(gitIn(['branch', '--list', 'claim/alpha'], repo).trim()).toBe('');
		expect(gitIn(['branch', '--list', 'work/prd-alpha'], repo).trim()).toBe('');
	});

	it('records the locker in the lock COMMIT subject', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		await acquireSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			by: 'alice',
			env: gitEnv(),
		});
		const subject = gitIn(['log', '-1', '--format=%s', 'arbiter/main'], repo);
		expect(subject.trim()).toBe('slicing: lock alpha (by alice)');
	});

	it('dry-run reports the push and does NOT mutate the arbiter', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		const notes: string[] = [];
		const result = await acquireSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			dryRun: true,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(result.exitCode).toBe(0);
		expect(notes.some((n) => n.includes('[dry-run]'))).toBe(true);
		expect(prdOnArbiter(repo, 'alpha')).toBe(true);
		expect(slicingOnArbiter(repo, 'alpha')).toBe(false);
	});
});

describe('acquireSlicingLock — not lockable (exit 2)', () => {
	it('returns "lost" when there is no such PRD', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		const result = await acquireSlicingLock({
			slug: 'nope',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(2);
		expect(result.outcome).toBe('lost');
	});

	it('returns "lost" when the PRD is already held (in slicing/)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		const other = seeded.clone('other');
		const first = await acquireSlicingLock({
			slug: 'alpha',
			cwd: other,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(first.exitCode).toBe(0);
		const second = await acquireSlicingLock({
			slug: 'alpha',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(second.exitCode).toBe(2);
		expect(second.outcome).toBe('lost');
	});
});

describe('acquireSlicingLock — usage / env errors (exit 1)', () => {
	it('refuses on a dirty working tree', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		writeFileSync(join(repo, 'README.md'), '# project\nDIRTY\n');
		const result = await acquireSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(prdOnArbiter(repo, 'alpha')).toBe(true);
		expect(slicingOnArbiter(repo, 'alpha')).toBe(false);
	});

	it('errors when the arbiter remote does not exist', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		const result = await acquireSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'nope',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.message).toMatch(/no git remote named 'nope'/);
	});
});

describe('slicing-lock race — exactly one winner', () => {
	it('two simultaneous slicers ⇒ one acquires, the loser gets exit-2', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {prds: ['solo']});
		const a = seeded.clone('a');
		const b = seeded.clone('b');

		// Genuinely concurrent: the arbiter's ref-CAS picks the single winner.
		const [ra, rb] = await Promise.all([
			acquireSlicingLock({
				slug: 'solo',
				cwd: a,
				arbiter: 'arbiter',
				env: gitEnv(),
			}),
			acquireSlicingLock({
				slug: 'solo',
				cwd: b,
				arbiter: 'arbiter',
				env: gitEnv(),
			}),
		]);

		const acquired = [ra, rb].filter((r) => r.exitCode === 0);
		const lost = [ra, rb].filter((r) => r.exitCode === 2);
		expect(acquired).toHaveLength(1);
		expect(lost).toHaveLength(1);
		// The arbiter agrees: the PRD is held exactly once.
		expect(slicingOnArbiter(a, 'solo')).toBe(true);
		expect(prdOnArbiter(a, 'solo')).toBe(false);
	});
});

describe('releaseSlicingLock — happy path', () => {
	it('moves the PRD slicing/ -> prd/ on a clean release (exit 0)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		const acquired = await acquireSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		const result = await releaseSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			lockedBlob: acquired.lockedBlob,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('released');
		expect(prdOnArbiter(repo, 'alpha')).toBe(true);
		expect(slicingOnArbiter(repo, 'alpha')).toBe(false);
	});

	it('a release on top of an UNRELATED concurrent change still succeeds', async () => {
		// A different PRD edited concurrently must NOT make our release stale.
		const seeded = seedRepoWithArbiter(scratch.root, [], {
			prds: ['alpha', 'beta'],
		});
		const acquired = await acquireSlicingLock({
			slug: 'alpha',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		// A second writer edits a DIFFERENT PRD and pushes.
		const writer = seeded.clone('writer');
		gitIn(['checkout', '-q', '-B', 'edit-beta', 'arbiter/main'], writer);
		writeFileSync(
			join(writer, 'work', 'prd', 'beta.md'),
			prdFile('beta', 'EDITED'),
		);
		gitIn(['add', '-A'], writer);
		gitIn(['commit', '-q', '-m', 'edit beta'], writer);
		gitIn(['push', '-q', 'arbiter', 'edit-beta:main'], writer);

		const result = await releaseSlicingLock({
			slug: 'alpha',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			lockedBlob: acquired.lockedBlob,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('released');
		expect(prdOnArbiter(seeded.repo, 'alpha')).toBe(true);
		// The concurrent edit to beta survived.
		const beta = gitIn(['show', 'arbiter/main:work/prd/beta.md'], seeded.repo);
		expect(beta).toMatch(/EDITED/);
	});

	it('returns "lost" when the lock is not held', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		const result = await releaseSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			// A lockedBlob is now REQUIRED (omitted ⇒ refuse); pass a dummy so we still
			// exercise the "lock not held" path (it returns lost before any stale check).
			lockedBlob: '0'.repeat(40),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(2);
		expect(result.outcome).toBe('lost');
	});

	it('REFUSES (usage-error) when lockedBlob is omitted (never a silent overwrite)', async () => {
		// The omitted-lockedBlob path must REFUSE rather than skip the stale check and
		// blindly restore — closing the footgun the lock's first consumer flagged.
		const {repo} = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		const acquired = await acquireSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(acquired.exitCode).toBe(0);
		const result = await releaseSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			// lockedBlob deliberately omitted.
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/lockedBlob/);
		// The arbiter was NOT touched — the lock is still held, the PRD did not
		// silently return to prd/.
		expect(slicingOnArbiter(repo, 'alpha')).toBe(true);
		expect(prdOnArbiter(repo, 'alpha')).toBe(false);
	});
});

describe('releaseSlicingLock — concurrent PRD edit ⇒ STALE, fail loud', () => {
	it('a concurrent edit to the HELD PRD makes release conflict and fail loud', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		// Slicer acquires the lock (PRD now at work/slicing/alpha.md on main).
		const acquired = await acquireSlicingLock({
			slug: 'alpha',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(acquired.exitCode).toBe(0);

		// A second writer edits the HELD PRD body (work/slicing/alpha.md) and pushes.
		const writer = seeded.clone('writer');
		gitIn(['checkout', '-q', '-B', 'edit-alpha', 'arbiter/main'], writer);
		writeFileSync(
			join(writer, 'work', 'slicing', 'alpha.md'),
			prdFile('alpha', 'EDITED-UNDER-LOCK'),
		);
		gitIn(['add', '-A'], writer);
		gitIn(['commit', '-q', '-m', 'edit held PRD body'], writer);
		gitIn(['push', '-q', 'arbiter', 'edit-alpha:main'], writer);

		// Release must detect the edit (content-identity stale check) and FAIL LOUD.
		const result = await releaseSlicingLock({
			slug: 'alpha',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			lockedBlob: acquired.lockedBlob,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(4);
		expect(result.outcome).toBe('stale');
		expect(result.message).toMatch(/STALE/);

		// Arbiter untouched: the edit is preserved, the lock is still held, the PRD
		// did NOT silently return to prd/ (no stale slices could ride a silent
		// overwrite).
		expect(slicingOnArbiter(seeded.repo, 'alpha')).toBe(true);
		expect(prdOnArbiter(seeded.repo, 'alpha')).toBe(false);
		const held = gitIn(
			['show', 'arbiter/main:work/slicing/alpha.md'],
			seeded.repo,
		);
		expect(held).toMatch(/EDITED-UNDER-LOCK/);
	});
});
