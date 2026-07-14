import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ledgerWrite} from '../src/ledger-write.js';
import {performClaim} from '../src/claim-cas.js';
import {
	acquireItemLock,
	markStuckItemLock,
	readItemLock,
	listItemLockEntries,
} from '../src/item-lock.js';
import {status, formatStatus} from '../src/status.js';
import {scan} from '../src/scan.js';
import {mergeConfig} from '../src/config.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	registerMirrorWithWork,
	mirrorSrc,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	sidecarSurfacedOnArbiterMain,
	needsAnswersOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * needs-attention ALSO marks the `stuck` lock state, read by `status`/`scan` (task
 * `needs-attention-as-stuck-lock-state`; PRD `ledger-status-per-item-lock-refs` US
 * #5/#8; ADR `ledger-status-on-per-item-lock-refs`). The INTERIM DUAL-WRITE half:
 *
 *   - a bounce (`applyNeedsAttentionTransition` / the tree-less
 *     `applyTreelessNeedsAttentionTransition`) ADDITIONALLY marks the held per-item
 *     lock `state: stuck` + reason via the state-machine CAS amend, while KEEPING
 *     the existing `git mv in-progress→needs-attention` folder move + surface;
 *   - `status` / `scan` ADDITIONALLY read the lock refs to surface held
 *     (in-progress, `active`) and stuck (needs-attention, `stuck`) items + reasons,
 *     while keeping the folder-based views; eligibility/selection stay OFFLINE on
 *     `main` (pool still `backlog/`);
 *   - `done` (a `main` durable record) + a `stuck` lock may legitimately co-exist.
 *
 * All real git against a local `--bare file://` arbiter, writing only into its own
 * temp fixtures. These write `main`, so they live in the NON-PARALLEL vitest
 * project (vitest.config.ts RACE_SENSITIVE) to stay deterministic.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-na-stuck-lock-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/** Simulate the build agent: leave UNCOMMITTED work in the tree (no git). */
function agentEdits(repo: string, file = 'feature.txt', body = 'the work\n') {
	writeFileSync(join(repo, file), body);
}

/**
 * Stand a repo up exactly as the runner leaves it just before a stuck outcome: a
 * task CLAIMED (which, under the interim dual-write, ALSO acquired the per-item
 * `task:<slug>` lock `active`) and onboarded onto `work/task-<slug>` off the
 * freshly-pushed main, with the agent's uncommitted edits in the tree.
 */
async function claimAndBranch(
	slug: string,
): Promise<{repo: string; seeded: SeededRepo}> {
	const seeded = seedRepoWithArbiter(scratch.root, [slug]);
	const repo = seeded.repo;
	const claim = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	// Claim acquired the lock (interim dual-write) — held `active` for `implement`.
	const held = await readItemLock({
		item: `task:${slug}`,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(held?.state).toBe('active');
	expect(held?.action).toBe('implement');
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
	return {repo, seeded};
}

describe('bounce is a PURE lock amend (no folder move, no main write)', () => {
	it('surfaces the stuck item on <arbiter>/main (sidecar + needsAnswers) then releases the lock (PR-2b)', async () => {
		const {repo} = await claimAndBranch('alpha');
		agentEdits(repo);

		const result = await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'alpha',
			reason: 'acceptance gate failed (exit 1)',
			questions: ['relax the lint rule, or fix the code?'],
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// PR-2b (spec `surface-stuck-as-questions-and-retire-stuck-lock-state`):
		// a bounce SURFACES on `<arbiter>/main` (stuck-kind sidecar +
		// `needsAnswers:true` in ONE commit) THEN RELEASES the lock — the item rests
		// as a `needsAnswers:true` pool item (`eligible:false`). The body stays in
		// `tasks/ready/`.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'alpha')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'alpha')).toBe(true);
		const sidecar = gitIn(
			['show', `${ARBITER}/main:work/questions/task-alpha.md`],
			repo,
		);
		expect(sidecar).toMatch(/acceptance gate failed \(exit 1\)/);
		expect(sidecar).toMatch(/relax the lint rule, or fix the code\?/);
	});

	it('the tree-less surface (after-commit path) is ALSO a surface-then-release (PR-2b)', async () => {
		const {repo} = await claimAndBranch('beta');

		const surfaced = await ledgerWrite.applyTreelessNeedsAttentionTransition({
			cwd: repo,
			slug: 'beta',
			reason: 'continue rebase conflict (aborted)',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(surfaced.moved).toBe(true);

		expect(existsOnArbiterMain(repo, 'backlog', 'beta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'beta')).toBe(false);
		expect(stuckLockOnArbiter(repo, 'beta')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'beta')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'beta')).toBe(true);
	});

	it('a bounce with NO held lock is a tolerated surface (release idempotent) — never a dead-end held lock', async () => {
		// PR-2b: without a held lock the surface still lands on `<arbiter>/main`
		// and the (already-absent) lock release is a tolerated no-op — moved:true.
		const seeded = seedRepoWithArbiter(scratch.root, ['gamma']);
		const repo = seeded.repo;
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', 'work/task-gamma', `${ARBITER}/main`], repo);

		const result = await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'gamma',
			reason: 'agent failed',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		expect(stuckLockOnArbiter(repo, 'gamma')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'gamma')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'gamma')).toBe(true);
	});

	it('local-only routing (no arbiter) records a no-op success and touches NO main/lock', async () => {
		const {repo} = await claimAndBranch('delta');
		agentEdits(repo);
		const result = await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'delta',
			reason: 'just locally',
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		// No arbiter ⇒ no lock ref to amend (the human-local face). Main is untouched,
		// the body still rests in backlog/, and the lock (held active from claim)
		// remains active.
		expect(existsOnArbiterMain(repo, 'backlog', 'delta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'delta')).toBe(false);
		const lock = await readItemLock({
			item: 'task:delta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock?.state).toBe('active');
	});
});

describe('done + stuck lock co-existence (state-machine invariant)', () => {
	it('a stuck lock and a done-on-main record co-exist without corruption (the two substrates may disagree)', async () => {
		// Amendment 2 / the lock-entry invariant: a `done` durable record on `main`
		// and a `stuck` lock entry on the ref are INDEPENDENT substrates and may
		// legitimately disagree — the stuck lock wins the human's attention, the
		// `main` record wins dependency resolution. The lock-level co-existence is
		// what this task introduces; the lock amend touches ONLY the lock ref, so it
		// never corrupts the `main` durable record.
		const {repo, seeded} = await claimAndBranch('epsilon');

		// Seed a durable `done` record on main (a just-completed item), via a clone so
		// the checkout-under-test is untouched. The `implement` lock claim acquired is
		// still HELD (interim: complete does not yet release it — task #7).
		const completer = seeded.clone('completer');
		gitIn(['fetch', '-q', ARBITER], completer);
		gitIn(['switch', '-q', '-C', 'done-move', `${ARBITER}/main`], completer);
		mkdirSync(join(completer, 'work', 'tasks', 'done'), {recursive: true});
		gitIn(
			['mv', 'work/tasks/ready/epsilon.md', 'work/tasks/done/epsilon.md'],
			completer,
		);
		gitIn(['add', '-A'], completer);
		gitIn(['commit', '-q', '-m', 'done: epsilon'], completer);
		gitIn(['push', '-q', ARBITER, 'done-move:main'], completer);
		expect(existsOnArbiterMain(repo, 'done', 'epsilon')).toBe(true);

		// Mark the still-held lock STUCK directly (the lock half of a rebase-conflict
		// bounce of a just-completed item — the state-machine `active → stuck` amend).
		const marked = await markStuckItemLock({
			item: 'task:epsilon',
			reason: 'rebase onto arbiter/main conflicted (aborted)',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(marked.outcome).toBe('transitioned');

		// CO-EXISTENCE: the lock is stuck (the human's attention) AND `done` on main
		// is untouched by the lock amend (it touches only the lock ref) — the two
		// substrates legitimately disagree, no corruption.
		const lock = await readItemLock({
			item: 'task:epsilon',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock?.state).toBe('stuck');
		expect(lock?.reason).toMatch(/conflict/i);
		expect(existsOnArbiterMain(repo, 'done', 'epsilon')).toBe(true);
	});

	it('the full bounce of a done item surfaces on <arbiter>/main + releases the lock (PR-2b; done record preserved)', async () => {
		// PR-2b end-to-end via the seam: a rebase-conflict bounce of a JUST-COMPLETED
		// item. The bounce SURFACES on `<arbiter>/main` (sidecar + `needsAnswers:true`
		// commit) and RELEASES the lock. The pre-existing `done` record co-exists with
		// the surfaced sidecar in the same commit graph.
		const {repo, seeded} = await claimAndBranch('zeta');
		const completer = seeded.clone('zeta-completer');
		gitIn(['fetch', '-q', ARBITER], completer);
		gitIn(['switch', '-q', '-C', 'done-move', `${ARBITER}/main`], completer);
		mkdirSync(join(completer, 'work', 'tasks', 'done'), {recursive: true});
		gitIn(
			['mv', 'work/tasks/ready/zeta.md', 'work/tasks/done/zeta.md'],
			completer,
		);
		gitIn(['add', '-A'], completer);
		gitIn(['commit', '-q', '-m', 'done: zeta'], completer);
		gitIn(['push', '-q', ARBITER, 'done-move:main'], completer);
		expect(existsOnArbiterMain(repo, 'done', 'zeta')).toBe(true);

		const result = await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'zeta',
			reason: 'rebase onto arbiter/main conflicted (aborted)',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		// D1 probe finds the body only in tasks/done — no surface path candidate in
		// that namespace, so the surface is a body-absent no-op that STILL releases
		// the lock (never a dead-end held lock).
		expect(result.moved).toBe(true);
		expect(stuckLockOnArbiter(repo, 'zeta')).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'zeta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'zeta')).toBe(false);
	});
});

/**
 * Push a held (and optionally stuck) per-item lock ref onto a registered mirror's
 * ORIGIN (the source repo the bare mirror was cloned from), so `scan`/`status`
 * reading `listItemLockEntries(mirrorPath, 'origin')` fetch it. The lock module
 * pushes to a remote named `arbiter` here; the bare mirror's `origin` IS this
 * source, so the ref reaches the mirror's read path.
 */
async function seedLockOnMirrorOrigin(
	name: string,
	slug: string,
	opts: {stuck?: string; action?: 'implement' | 'task' | 'advance'} = {},
): Promise<void> {
	const src = mirrorSrc(workspacesDir(), name);
	const clone = join(scratch.root, `lock-seeder-${name}-${slug}`);
	gitIn(['clone', '-q', `file://${src}`, clone], scratch.root);
	gitIn(['remote', 'add', 'arbiter', `file://${src}`], clone);
	gitIn(['fetch', '-q', 'arbiter'], clone);
	// The identity NAMESPACE is `task:` (what the bounce surfaces); the lock ACTION
	// axis (`implement`/`task`/`advance`) is a SEPARATE field passed to acquire.
	const item = `task:${slug}`;
	const acq = await acquireItemLock({
		item,
		action: opts.action ?? 'implement',
		cwd: clone,
		arbiter: 'arbiter',
		env: gitEnv(),
	});
	expect(acq.outcome).toBe('acquired');
	if (opts.stuck !== undefined) {
		const marked = await markStuckItemLock({
			item, // = `task:${slug}`
			reason: opts.stuck,
			cwd: clone,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(marked.outcome).toBe('transitioned');
	}
}

/** The workspacesDir whose `repos/` carries the registered bare mirror fixtures. */
function workspacesDir(): string {
	return join(scratch.root, '.dorfl');
}

describe('status ADDITIONALLY reads the lock refs (held + stuck + reasons)', () => {
	it('surfaces an active (in-progress) and a stuck (needs-attention) lock entry from the mirror', async () => {
		const {mirrorPath} = registerMirrorWithWork(workspacesDir(), 'project', {
			backlog: {'held.md': 'x', 'broken.md': 'y'},
		});
		// One active hold (in-progress) + one stuck hold (needs-attention) on the
		// mirror's origin lock refs.
		await seedLockOnMirrorOrigin('project', 'held', {action: 'implement'});
		await seedLockOnMirrorOrigin('project', 'broken', {
			action: 'implement',
			stuck: 'acceptance gate failed (exit 1)',
		});

		const report = await status({
			workspacesDir: workspacesDir(),
			mirrorPaths: [mirrorPath],
		});
		expect(report.lockHeld).toHaveLength(1);
		const entries = report.lockHeld?.[0].entries ?? [];
		expect(entries).toHaveLength(2);
		const stuck = entries.find((e) => e.state === 'stuck');
		const active = entries.find((e) => e.state === 'active');
		expect(active?.entry).toBe('task-held');
		expect(stuck?.entry).toBe('task-broken');
		expect(stuck?.reason).toMatch(/acceptance gate failed/);

		const out = formatStatus(report);
		expect(out).toMatch(/In-flight locks/);
		expect(out).toMatch(/task-held/);
		expect(out).toMatch(/in-progress/);
		expect(out).toMatch(/task-broken/);
		expect(out).toMatch(/needs-attention/);
		expect(out).toMatch(/acceptance gate failed/);
		expect(out).toMatch(/in-flight lock\(s\)/);
	});

	it('reports no in-flight locks when none are held', async () => {
		const {mirrorPath} = registerMirrorWithWork(workspacesDir(), 'project', {
			backlog: {'idle.md': 'x'},
		});
		const report = await status({
			workspacesDir: workspacesDir(),
			mirrorPaths: [mirrorPath],
		});
		expect(report.lockHeld).toEqual([]);
	});
});

describe('scan ADDITIONALLY reads the lock refs (surface only; selection stays offline)', () => {
	it('surfaces held + stuck lock entries while still scoring the offline backlog pool', async () => {
		const {mirrorPath} = registerMirrorWithWork(workspacesDir(), 'project', {
			backlog: {'open.md': 'x', 'busy.md': 'y'},
		});
		// `busy` is held (lock active) — its body is still in backlog/ (interim), so
		// the held-slug subtraction removes it from the eligible pool, while `open`
		// stays eligible.
		await seedLockOnMirrorOrigin('project', 'busy', {action: 'implement'});

		const report = await scan(mergeConfig({workspacesDir: workspacesDir()}));
		const repo = report.repos.find((r) => r.path === mirrorPath);
		expect(repo).toBeDefined();
		// The lock surface lists the held entry…
		expect(repo?.lockHeld?.map((e) => e.entry)).toContain('task-busy');
		// …and the OFFLINE selection still reads the backlog pool, with the held slug
		// subtracted (eligibility stays offline on `main`).
		const slugs = repo?.items.map((i) => i.slug) ?? [];
		expect(slugs).toContain('open');
		expect(slugs).not.toContain('busy');
	});
});
