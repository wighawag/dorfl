import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {statSync} from 'node:fs';
import {join} from 'node:path';
import {
	prepareTreelessSurfaceCommit,
	surfaceStuckToNeedsAttention,
} from '../src/needs-attention.js';
import {acquireItemLock, readItemLock} from '../src/item-lock.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {parseSidecar} from '../src/sidecar.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	pathOnArbiterMain,
	sidecarSurfacedOnArbiterMain,
	needsAnswersOnArbiterMain,
	stuckLockOnArbiter,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * PR-1 (spec `surface-stuck-as-questions-and-retire-stuck-lock-state`, task
 * `bounce-surfaces-stuck-sidecar-and-releases-lock`): ADDITIVE tests for the
 * new tree-less surface primitive `prepareTreelessSurfaceCommit` + its harness
 * `surfaceStuckToNeedsAttention`. PR-1 boundary: no seam is flipped, no
 * existing `stuckLockOnArbiter(...).toBe(true)` assertion migrates; these tests
 * only exercise the new primitive in isolation against a canned arbiter.
 *
 * Drives real git against a --bare `file://` arbiter (writes main), so it lives
 * in the RACE_SENSITIVE vitest project alongside the other main-CAS tests.
 */

let scratch: Scratch;

beforeEach(() => {
	scratch = makeScratch('dorfl-bounce-surface-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

async function seedWithActiveLock(slug: string): Promise<{repo: string}> {
	const seeded = seedRepoWithArbiter(scratch.root, [slug]);
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

/** Snapshot the pieces of "cwd state" the primitive must NOT touch. */
function snapshotWorkingState(repo: string): {
	head: string;
	status: string;
	index: string;
	itemMtimeMs: number;
} {
	return {
		head: gitIn(['rev-parse', 'HEAD'], repo).trim(),
		status: gitIn(['status', '--porcelain'], repo),
		index: gitIn(['ls-files', '-s'], repo),
		itemMtimeMs: statSync(join(repo, 'work', 'tasks', 'ready', 'alpha.md'))
			.mtimeMs,
	};
}

describe('prepareTreelessSurfaceCommit — in-isolation primitive', () => {
	it('produces a two-file commit that lands the sidecar + flips needsAnswers on main via runTreelessLedgerMove', async () => {
		const {repo} = await seedWithActiveLock('alpha');

		const notes: string[] = [];
		const result = await surfaceStuckToNeedsAttention({
			cwd: repo,
			slug: 'alpha',
			itemPath: 'work/tasks/ready/alpha.md',
			reason: 'acceptance gate failed (exit 1)',
			questions: [
				{question: 'Should we try again?', context: 'first attempt red'},
			],
			arbiter: ARBITER,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});

		expect(result.surfaced).toBe(true);
		expect(result.released).toBe(true);

		// The sidecar landed on <arbiter>/main with the envelope entry + the
		// agent-surfaced question (both stamped `stuck` kind).
		expect(sidecarSurfacedOnArbiterMain(repo, 'alpha')).toBe(true);
		expect(pathOnArbiterMain(repo, 'work/questions/task-alpha.md')).toBe(true);
		const sidecarBody = gitIn(
			['show', `${ARBITER}/main:work/questions/task-alpha.md`],
			repo,
		);
		const model = parseSidecar(sidecarBody);
		expect(model.entries.length).toBe(2);
		expect(model.entries[0].context).toMatch(/acceptance gate failed/);
		expect(model.entries[0].kind).toBe('stuck');
		expect(model.entries[1].question).toMatch(/try again/);
		expect(model.entries[1].kind).toBe('stuck');

		// The item body on <arbiter>/main carries `needsAnswers: true`.
		expect(needsAnswersOnArbiterMain(repo, 'alpha')).toBe(true);
		const bodyOnMain = gitIn(
			['show', `${ARBITER}/main:work/tasks/ready/alpha.md`],
			repo,
		);
		expect(parseFrontmatter(bodyOnMain).needsAnswers).toBe(true);

		// Both files landed in the SAME commit on main (one-commit atomic surface).
		const touched = gitIn(
			['show', '--name-only', '--format=', `${ARBITER}/main`],
			repo,
		)
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l !== '');
		expect(touched).toContain('work/tasks/ready/alpha.md');
		expect(touched).toContain('work/questions/task-alpha.md');
	});

	it('touches NO working tree (cwd HEAD, index, worktree file untouched)', async () => {
		const {repo} = await seedWithActiveLock('alpha');
		const before = snapshotWorkingState(repo);

		// Drive the pure primitive against the arbiter's main base directly (this
		// is the tree-less path's contract — no working tree required).
		gitIn(['fetch', '-q', ARBITER], repo);
		const base = gitIn(['rev-parse', `${ARBITER}/main`], repo).trim();
		const {ref, commit} = prepareTreelessSurfaceCommit({
			cwd: repo,
			slug: 'alpha',
			item: 'task:alpha',
			itemPath: 'work/tasks/ready/alpha.md',
			base,
			reason: 'timeout after 30m',
			commitMessage: 'surface task:alpha (stuck): timeout after 30m',
			refNamespace: 'surface-stuck-test',
			env: gitEnv(),
		});
		expect(commit).toMatch(/^[0-9a-f]{40}$/);
		expect(ref).toBe(`refs/dorfl/surface-stuck-test/alpha`);

		// The prepared commit exists in the object store and holds BOTH files.
		const preparedFiles = gitIn(
			['show', '--name-only', '--format=', commit],
			repo,
		);
		expect(preparedFiles).toMatch(/work\/tasks\/ready\/alpha\.md/);
		expect(preparedFiles).toMatch(/work\/questions\/task-alpha\.md/);

		// The cwd HEAD, index, and worktree file are UNTOUCHED — the whole point
		// of the tree-less primitive.
		const after = snapshotWorkingState(repo);
		expect(after.head).toBe(before.head);
		expect(after.status).toBe(before.status);
		expect(after.index).toBe(before.index);
		expect(after.itemMtimeMs).toBe(before.itemMtimeMs);
	});

	it('ordering (happy path): main advances with the surface commit, THEN the lock ref is deleted', async () => {
		const {repo} = await seedWithActiveLock('alpha');
		const before = gitIn(['rev-parse', `${ARBITER}/main`], repo).trim();

		const result = await surfaceStuckToNeedsAttention({
			cwd: repo,
			slug: 'alpha',
			itemPath: 'work/tasks/ready/alpha.md',
			reason: 'stuck',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.surfaced).toBe(true);
		expect(result.released).toBe(true);

		// main ADVANCED by exactly one surface commit (the primitive's single-
		// commit contract): the new tip's parent is the pre-surface main.
		const after = gitIn(['rev-parse', `${ARBITER}/main`], repo).trim();
		expect(after).not.toBe(before);
		const parents = gitIn(['rev-list', '--parents', '-n', '1', after], repo)
			.trim()
			.split(/\s+/);
		expect(parents[1]).toBe(before);

		// The lock ref is GONE (release-second landed) — the observable of the
		// post-surface release wired into the harness.
		const lock = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock).toBeUndefined();
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(false);
	});

	it('ordering (failed surface): a MISSING item leaves main untouched AND the lock UNRELEASED (release only fires post-publish)', async () => {
		// Seed with an active lock but ask to surface against an itemPath that is
		// NOT tracked on main: the plan returns `missing`, `runTreelessLedgerMove`
		// reports moved=false, and the harness must NOT release the lock — that is
		// the surface-first-release-second ordering the spec's decision #4 pins.
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
		expect(result.reasonNotSurfaced).toMatch(/missing|contention/);

		// main UNCHANGED.
		const afterMain = gitIn(['rev-parse', `${ARBITER}/main`], repo).trim();
		expect(afterMain).toBe(beforeMain);

		// Lock still HELD active (never released — surface didn't land).
		const lock = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock?.state).toBe('active');
	});

	it('appends (never overwrites) when the sidecar already exists on main', async () => {
		const {repo} = await seedWithActiveLock('alpha');

		// First surface: creates the sidecar (envelope entry).
		const first = await surfaceStuckToNeedsAttention({
			cwd: repo,
			slug: 'alpha',
			itemPath: 'work/tasks/ready/alpha.md',
			reason: 'first bounce',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(first.surfaced).toBe(true);

		// Re-acquire the lock so the second surface has a lock to release.
		const reacquired = await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(reacquired.outcome).toBe('acquired');

		// Second surface: APPENDS a fresh envelope entry (never overwrites).
		const second = await surfaceStuckToNeedsAttention({
			cwd: repo,
			slug: 'alpha',
			itemPath: 'work/tasks/ready/alpha.md',
			reason: 'second bounce',
			questions: [{question: 'A follow-up?', context: 'more context'}],
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(second.surfaced).toBe(true);

		const sidecarBody = gitIn(
			['show', `${ARBITER}/main:work/questions/task-alpha.md`],
			repo,
		);
		const model = parseSidecar(sidecarBody);
		// One envelope (first) + one envelope (second) + one agent question.
		expect(model.entries.length).toBe(3);
		expect(model.entries[0].context).toMatch(/first bounce/);
		expect(model.entries[1].context).toMatch(/second bounce/);
		expect(model.entries[2].question).toMatch(/follow-up/);
	});
});

describe('PR-1 boundary — `bounceToStuckLock` and its 137 assertions stay untouched', () => {
	it('exercising the new primitive on ONE item does NOT mark ANOTHER item stuck (isolation)', async () => {
		// A sanity check that the new surface primitive is ADDITIVE and does not
		// touch any existing bounce path — a peer item's lock is untouched. If PR-1
		// accidentally called bounceToStuckLock, this would flip stuck for the
		// bystander (or at minimum leak a main write there).
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha', 'bystander']);
		await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		await acquireItemLock({
			item: 'task:bystander',
			action: 'implement',
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		const result = await surfaceStuckToNeedsAttention({
			cwd: seeded.repo,
			slug: 'alpha',
			itemPath: 'work/tasks/ready/alpha.md',
			reason: 'stuck',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.surfaced).toBe(true);
		expect(result.released).toBe(true);

		// bystander's lock ref is UNTOUCHED (still active, never marked stuck).
		expect(stuckLockOnArbiter(seeded.repo, 'bystander')).toBe(false);
		const bystanderLock = await readItemLock({
			item: 'task:bystander',
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(bystanderLock?.state).toBe('active');
		// bystander has no surfaced sidecar or needsAnswers flip either.
		expect(sidecarSurfacedOnArbiterMain(seeded.repo, 'bystander')).toBe(false);
		expect(needsAnswersOnArbiterMain(seeded.repo, 'bystander')).toBe(false);
	});
});
