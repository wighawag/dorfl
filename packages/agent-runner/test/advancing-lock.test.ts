import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {
	acquireAdvancingLock,
	releaseAdvancingLock,
	createItemThroughCas,
} from '../src/advancing-lock.js';
import {acquireSlicingLock} from '../src/slicing-lock.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	raceClone,
	racerEnv,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

let scratch: Scratch;

beforeEach(() => {
	scratch = makeScratch('agent-runner-advancing-lock-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Does `<arbiter>/main` track `work/<folder>/<entry>.md`? (soft check). */
function trackedOnArbiter(cwd: string, folder: string, entry: string): boolean {
	run('git', ['fetch', '-q', 'arbiter'], cwd, {env: gitEnv()});
	return (
		run(
			'git',
			['cat-file', '-e', `arbiter/main:work/${folder}/${entry}.md`],
			cwd,
			{env: gitEnv()},
		).status === 0
	);
}
const advancingOnArbiter = (cwd: string, entry: string): boolean =>
	trackedOnArbiter(cwd, 'advancing', entry);

describe('acquireAdvancingLock — happy path', () => {
	it('writes the type-encoded marker on the arbiter (exit 0)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await acquireAdvancingLock({
			item: 'slice:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('acquired');
		expect(result.entry).toBe('slice-alpha');
		expect(advancingOnArbiter(repo, 'slice-alpha')).toBe(true);
		// The borrow is a LOCK, not a lifecycle move: the item is untouched.
		expect(trackedOnArbiter(repo, 'backlog', 'alpha')).toBe(true);
	});

	it('keys a bare slug to the slice type (slice-<slug>)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await acquireAdvancingLock({
			item: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.entry).toBe('slice-alpha');
		expect(advancingOnArbiter(repo, 'slice-alpha')).toBe(true);
	});

	it('keys a PRD to prd-<slug> and an observation to observation-<slug>', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {prds: ['beta']});
		const prd = await acquireAdvancingLock({
			item: 'prd:beta',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(prd.exitCode).toBe(0);
		expect(prd.entry).toBe('prd-beta');
		expect(advancingOnArbiter(repo, 'prd-beta')).toBe(true);

		const obs = await acquireAdvancingLock({
			item: 'obs:gamma',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(obs.exitCode).toBe(0);
		expect(obs.entry).toBe('observation-gamma');
		expect(advancingOnArbiter(repo, 'observation-gamma')).toBe(true);
	});

	it('uses an advancing/<entry> branch distinct from claim/slicing/work', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireAdvancingLock({
			item: 'slice:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(
			gitIn(['branch', '--list', 'advancing/slice-alpha'], repo).trim(),
		).toBe('');
		expect(gitIn(['branch', '--list', 'claim/alpha'], repo).trim()).toBe('');
		expect(gitIn(['branch', '--list', 'slicing/alpha'], repo).trim()).toBe('');
		expect(gitIn(['branch', '--list', 'work/slice-alpha'], repo).trim()).toBe(
			'',
		);
	});

	it('records the locker in the lock COMMIT subject', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireAdvancingLock({
			item: 'slice:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			by: 'alice',
			env: gitEnv(),
		});
		const subject = gitIn(['log', '-1', '--format=%s', 'arbiter/main'], repo);
		expect(subject.trim()).toBe('advancing: lock slice-alpha (by alice)');
	});

	it('dry-run reports the push and does NOT mutate the arbiter', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const notes: string[] = [];
		const result = await acquireAdvancingLock({
			item: 'slice:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			dryRun: true,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(result.exitCode).toBe(0);
		expect(notes.some((n) => n.includes('[dry-run]'))).toBe(true);
		expect(advancingOnArbiter(repo, 'slice-alpha')).toBe(false);
	});
});

describe('acquireAdvancingLock — already held (exit 2)', () => {
	it('returns "lost" when the advancing lock is already held', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const other = seeded.clone('other');
		const first = await acquireAdvancingLock({
			item: 'slice:alpha',
			cwd: other,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(first.exitCode).toBe(0);
		const second = await acquireAdvancingLock({
			item: 'slice:alpha',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(second.exitCode).toBe(2);
		expect(second.outcome).toBe('lost');
	});
});

describe('acquireAdvancingLock — usage / env errors (exit 1)', () => {
	it('refuses on a dirty working tree', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		writeFileSync(join(repo, 'README.md'), '# project\nDIRTY\n');
		const result = await acquireAdvancingLock({
			item: 'slice:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(advancingOnArbiter(repo, 'slice-alpha')).toBe(false);
	});

	it('errors when the arbiter remote does not exist', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await acquireAdvancingLock({
			item: 'slice:alpha',
			cwd: repo,
			arbiter: 'nope',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.message).toMatch(/no git remote named 'nope'/);
	});

	it('errors on an empty item identity', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await acquireAdvancingLock({
			item: '',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
	});
});

describe('advancing-lock race — exactly one winner', () => {
	it('two simultaneous ticks ⇒ one acquires, the loser gets exit-2', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		// Distinct committer identity per racer so the two lock micro-commits get
		// DISTINCT shas (as two real ticks would) and the loser loses through the
		// genuine path-exists/lease CAS, not a fixture sha-collision. See racerEnv.
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');

		const [ra, rb] = await Promise.all([
			acquireAdvancingLock({
				item: 'slice:solo',
				cwd: a,
				arbiter: 'arbiter',
				env: racerEnv('a'),
			}),
			acquireAdvancingLock({
				item: 'slice:solo',
				cwd: b,
				arbiter: 'arbiter',
				env: racerEnv('b'),
			}),
		]);

		const acquired = [ra, rb].filter((r) => r.exitCode === 0);
		const lost = [ra, rb].filter((r) => r.exitCode === 2);
		expect(acquired).toHaveLength(1);
		expect(lost).toHaveLength(1);
		expect(advancingOnArbiter(a, 'slice-solo')).toBe(true);
	});
});

describe('advancing-lock does NOT collide with slicing/build on the same slug', () => {
	it('an advancing-borrow on prd:x coexists with a slicing-borrow on x', async () => {
		// Same slug `dual`, different ACTIONS → distinct refs/entries, never co-held
		// collide. A PRD may hold `advancing` and (later/separately) `slicing`.
		const seeded = seedRepoWithArbiter(scratch.root, [], {prds: ['dual']});

		const advancing = await acquireAdvancingLock({
			item: 'prd:dual',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(advancing.exitCode).toBe(0);
		expect(advancing.entry).toBe('prd-dual');

		// The slicing lock on the SAME slug still acquires — different action/ref.
		const slicing = await acquireSlicingLock({
			slug: 'dual',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(slicing.exitCode).toBe(0);

		// Both locks are held simultaneously on distinct refs/folders.
		expect(advancingOnArbiter(seeded.repo, 'prd-dual')).toBe(true);
		expect(trackedOnArbiter(seeded.repo, 'slicing', 'dual')).toBe(true);
	});

	it('an advancing-borrow on slice:x coexists with a build-claim on x', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['dual']);

		const advancing = await acquireAdvancingLock({
			item: 'slice:dual',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(advancing.exitCode).toBe(0);

		// The build claim on the SAME slug still lands — different action/ref.
		const claim = await performClaim({
			slug: 'dual',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);

		expect(advancingOnArbiter(seeded.repo, 'slice-dual')).toBe(true);
		// The build claim acquires the per-item lock; the body stays in backlog/.
		expect(trackedOnArbiter(seeded.repo, 'backlog', 'dual')).toBe(true);
	});
});

describe('releaseAdvancingLock — short borrow, no lifecycle move', () => {
	it('removes the marker WITHOUT moving the item (exit 0)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const acquired = await acquireAdvancingLock({
			item: 'slice:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(acquired.exitCode).toBe(0);
		expect(advancingOnArbiter(repo, 'slice-alpha')).toBe(true);

		const released = await releaseAdvancingLock({
			item: 'slice:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(released.exitCode).toBe(0);
		expect(released.outcome).toBe('released');
		// The marker is gone; the item NEVER moved status folder (lock, not transition).
		expect(advancingOnArbiter(repo, 'slice-alpha')).toBe(false);
		expect(trackedOnArbiter(repo, 'backlog', 'alpha')).toBe(true);
	});

	it('a short acquire→release cycle leaves the lock re-acquirable', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireAdvancingLock({
			item: 'slice:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		await releaseAdvancingLock({
			item: 'slice:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		const reacquired = await acquireAdvancingLock({
			item: 'slice:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(reacquired.exitCode).toBe(0);
	});

	it('returns "lost" when the lock is not held', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await releaseAdvancingLock({
			item: 'slice:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(2);
		expect(result.outcome).toBe('lost');
	});
});

describe('createItemThroughCas — new-item creation keyed on the new identity', () => {
	it('creates a new backlog item via the CAS (exit 0)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await createItemThroughCas({
			path: 'work/backlog/promoted.md',
			content: '---\ntitle: promoted\nslug: promoted\nblockedBy: []\n---\n',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('created');
		expect(trackedOnArbiter(repo, 'backlog', 'promoted')).toBe(true);
	});

	it('a same-path new-item race ⇒ exactly one creates, the loser loses (no special case)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		// Distinct committer identity per racer so the two create commits get
		// DISTINCT shas (as two real machines would) and the loser loses through the
		// genuine path-exists/lease CAS, not a fixture sha-collision. See racerEnv.
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');
		const content = '---\ntitle: dup\nslug: dup\nblockedBy: []\n---\n';

		const [ra, rb] = await Promise.all([
			createItemThroughCas({
				path: 'work/backlog/dup.md',
				content,
				cwd: a,
				arbiter: 'arbiter',
				env: racerEnv('a'),
			}),
			createItemThroughCas({
				path: 'work/backlog/dup.md',
				content,
				cwd: b,
				arbiter: 'arbiter',
				env: racerEnv('b'),
			}),
		]);

		const created = [ra, rb].filter((r) => r.exitCode === 0);
		const lost = [ra, rb].filter((r) => r.exitCode === 2);
		expect(created).toHaveLength(1);
		expect(lost).toHaveLength(1);
		expect(trackedOnArbiter(a, 'backlog', 'dup')).toBe(true);
	});

	it('returns "lost" when the target path already exists on the arbiter', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['exists']);
		const result = await createItemThroughCas({
			path: 'work/backlog/exists.md',
			content: '---\ntitle: exists\nslug: exists\n---\n',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(2);
		expect(result.outcome).toBe('lost');
	});
});
