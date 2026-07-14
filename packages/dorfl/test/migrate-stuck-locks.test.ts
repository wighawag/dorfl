import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	migrateStuckLocks,
	isLegacyStuckBlob,
	extractLegacyReason,
	extractLegacyQuestions,
} from '../src/migrate-stuck-locks.js';
import {parseSidecar} from '../src/sidecar.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	heldLockOnArbiter,
	needsAnswersOnArbiterMain,
	sidecarSurfacedOnArbiterMain,
	stuckLockOnArbiter,
	type Scratch,
} from './helpers/gitRepo.js';
import {git as gitWithInput} from '../src/git.js';

/**
 * ONE-SHOT migration of pre-existing `stuck` per-item lock refs to the
 * post-`retire-stuck-lock-state` resting shape (task
 * `migrate-existing-stuck-locks-one-shot`, spec
 * `surface-stuck-as-questions-and-retire-stuck-lock-state` resolved decision
 * #3, user story 5).
 *
 * These tests drive real git against a --bare `file://` arbiter (writes main
 * via the shared surface-first-release-second transition), so they live in
 * the RACE_SENSITIVE vitest project alongside the other main-CAS tests.
 */

let scratch: Scratch;

beforeEach(() => {
	scratch = makeScratch('dorfl-migrate-stuck-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * Seed a LEGACY `state: stuck` lock ref on the arbiter for `task:<slug>`
 * (the shape the retired lock module produced): frontmatter with
 * `state: stuck` + a `## Reason` block + a `## Questions` bulleted list.
 * Uses git plumbing so no live path is involved (a live path in the current
 * binary can no longer WRITE `state: stuck`).
 */
function seedLegacyStuckLock(
	repo: string,
	slug: string,
	reason: string,
	questions: string[],
): void {
	const entry = `task-${slug}`;
	const ref = `refs/dorfl/lock/${entry}`;
	const bodyLines = [
		'---',
		`entry: ${entry}`,
		'action: implement',
		'state: stuck',
		'holder: legacy-test',
		'since: 2026-01-01T00:00:00.000Z',
		'---',
		'',
		`Lock held for \`${entry}\` (implement/stuck).`,
		'',
		'## Reason',
		'',
		reason,
	];
	if (questions.length > 0) {
		bodyLines.push('', '## Questions', '');
		for (const q of questions) {
			bodyLines.push(`- ${q}`);
		}
	}
	bodyLines.push('');
	const body = bodyLines.join('\n');
	// Hand-craft the parentless commit whose tree contains the single
	// `lock.md` blob, then push to the arbiter's lock ref (create-only ref via
	// `push --force`, but the migration proper uses a leased delete on release).
	const env = gitEnv();
	const blob = gitWithInput(['hash-object', '-w', '--stdin'], repo, {
		input: body,
		env,
	}).trim();
	const treeInput = `100644 blob ${blob}\tlock.md\n`;
	const tree = gitWithInput(['mktree'], repo, {input: treeInput, env}).trim();
	const commit = gitWithInput(
		['commit-tree', tree, '-m', `legacy stuck seed for ${entry}`],
		repo,
		{env},
	).trim();
	gitIn(['push', `file://${arbiterPath(repo)}`, `${commit}:${ref}`], repo);
	// Refresh local mirror of the lock ref so subsequent local reads see it.
	gitIn(['fetch', '-q', ARBITER, `+refs/dorfl/lock/*:refs/dorfl/lock/*`], repo);
}

/**
 * Resolve the bare-arbiter path from a working clone. `seedRepoWithArbiter`
 * always registers the bare arbiter as the `arbiter` remote pointing at a
 * sibling `<root>/project-work.git`, so we can derive the fs path from the
 * remote URL.
 */
function arbiterPath(repo: string): string {
	const url = gitIn(['remote', 'get-url', ARBITER], repo).trim();
	return url.replace(/^file:\/\//, '');
}

describe('migrateStuckLocks — one-shot rollout migration', () => {
	it('migrates N legacy stuck refs to N surfaced items + zero stuck refs, idempotent on re-run', async () => {
		const slugs = ['alpha', 'beta', 'gamma'];
		const seeded = seedRepoWithArbiter(scratch.root, slugs);
		for (const slug of slugs) {
			seedLegacyStuckLock(seeded.repo, slug, `bounce for ${slug}`, []);
			// Sanity: legacy shape is on the arbiter and the helper agrees.
			expect(stuckLockOnArbiter(seeded.repo, slug)).toBe(true);
		}

		const report = await migrateStuckLocks({
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(report.migrated).toBe(slugs.length);
		expect(report.lost).toBe(0);
		expect(report.errors).toBe(0);
		expect(report.skippedNoItemForm).toBe(0);

		for (const slug of slugs) {
			// The keystone shape: no stuck ref, sidecar surfaced on main, body
			// carries `needsAnswers: true` — the SAME resting shape a fresh
			// bounce produces.
			expect(stuckLockOnArbiter(seeded.repo, slug)).toBe(false);
			expect(heldLockOnArbiter(seeded.repo, slug)).toBe(false);
			expect(sidecarSurfacedOnArbiterMain(seeded.repo, slug)).toBe(true);
			expect(needsAnswersOnArbiterMain(seeded.repo, slug)).toBe(true);
		}

		// Idempotency: a re-run finds no legacy stuck ref and is a clean no-op.
		const rerun = await migrateStuckLocks({
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(rerun.migrated).toBe(0);
		expect(rerun.lost).toBe(0);
		expect(rerun.errors).toBe(0);
		// The refs really are gone — enumeration is empty.
		expect(rerun.entries.length).toBe(0);
	});

	it("preserves the lock entry's reason + questions into the surfaced sidecar", async () => {
		const slug = 'delta';
		const seeded = seedRepoWithArbiter(scratch.root, [slug]);
		seedLegacyStuckLock(seeded.repo, slug, 'acceptance gate failed (exit 1)', [
			'Should we bump the timeout?',
			'Is the flaky sub-step already tracked?',
		]);

		const report = await migrateStuckLocks({
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(report.migrated).toBe(1);

		const body = gitIn(
			['show', `${ARBITER}/main:work/questions/task-${slug}.md`],
			seeded.repo,
		);
		const model = parseSidecar(body);
		// Envelope (context = reason) + 2 agent questions round-trip.
		expect(model.entries.length).toBe(3);
		expect(model.entries[0].context).toMatch(/acceptance gate failed/);
		expect(model.entries[0].kind).toBe('stuck');
		expect(model.entries[1].question).toMatch(/bump the timeout/);
		expect(model.entries[1].kind).toBe('stuck');
		expect(model.entries[2].question).toMatch(/flaky sub-step/);
		expect(model.entries[2].kind).toBe('stuck');
	});

	it('leaves a healthy active lock untouched (only legacy stuck shape migrates)', async () => {
		const slug = 'epsilon';
		const seeded = seedRepoWithArbiter(scratch.root, [slug]);
		// Acquire the lock through the LIVE lock module (writes `state: active`).
		const {acquireItemLock} = await import('../src/item-lock.js');
		const acquired = await acquireItemLock({
			item: `task:${slug}`,
			action: 'implement',
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(acquired.outcome).toBe('acquired');

		const report = await migrateStuckLocks({
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(report.migrated).toBe(0);
		expect(report.notStuck).toBe(1);
		expect(report.lost).toBe(0);
		expect(report.errors).toBe(0);
		// The active hold is preserved (real CAS mutual-exclusion is untouched);
		// no sidecar was surfaced.
		expect(heldLockOnArbiter(seeded.repo, slug)).toBe(true);
		expect(sidecarSurfacedOnArbiterMain(seeded.repo, slug)).toBe(false);
		expect(needsAnswersOnArbiterMain(seeded.repo, slug)).toBe(false);
	});
});

describe('migrateStuckLocks — pure body parsers', () => {
	it('isLegacyStuckBlob keys off `state: stuck` in the frontmatter', () => {
		const legacy = [
			'---',
			'entry: task-foo',
			'action: implement',
			'state: stuck',
			'holder: x',
			'since: t',
			'---',
			'',
		].join('\n');
		const active = legacy.replace('state: stuck', 'state: active');
		expect(isLegacyStuckBlob(legacy)).toBe(true);
		expect(isLegacyStuckBlob(active)).toBe(false);
		expect(isLegacyStuckBlob('no frontmatter at all')).toBe(false);
	});

	it('extractLegacyReason prefers `## Reason` block over a legacy `reason:` field', () => {
		const both = [
			'---',
			'entry: task-foo',
			'action: implement',
			'state: stuck',
			'reason: old-style one-liner',
			'---',
			'',
			'## Reason',
			'',
			'first line',
			'second line',
			'',
			'## Questions',
			'',
			'- q1',
		].join('\n');
		expect(extractLegacyReason(both)).toBe('first line\nsecond line');

		const legacyOnly = both.replace(
			/## Reason\n\nfirst line\nsecond line\n\n/,
			'',
		);
		expect(extractLegacyReason(legacyOnly)).toBe('old-style one-liner');

		expect(
			extractLegacyReason('---\nentry: x\naction: a\nstate: stuck\n---\n'),
		).toBeUndefined();
	});

	it('extractLegacyQuestions yields the `## Questions` bullets or []', () => {
		const body = [
			'---',
			'entry: task-foo',
			'action: implement',
			'state: stuck',
			'---',
			'',
			'## Questions',
			'',
			'- one',
			'- two',
		].join('\n');
		expect(extractLegacyQuestions(body)).toEqual(['one', 'two']);
		expect(extractLegacyQuestions('nothing here')).toEqual([]);
	});
});
