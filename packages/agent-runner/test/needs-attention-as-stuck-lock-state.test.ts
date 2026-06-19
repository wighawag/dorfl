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
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * needs-attention ALSO marks the `stuck` lock state, read by `status`/`scan` (slice
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
	scratch = makeScratch('agent-runner-na-stuck-lock-');
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
 * slice CLAIMED (which, under the interim dual-write, ALSO acquired the per-item
 * `slice:<slug>` lock `active`) and onboarded onto `work/task-<slug>` off the
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
	it('marks the lock stuck + reason; the body STAYS in backlog/ (no needs-attention/ folder move)', async () => {
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

		// NO main write: the body rests in backlog/ (it never moved on claim, 9a) and
		// NO needs-attention/ folder file is written (the folder is retired, 9b).
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);

		// The held lock is now the SOLE stuck record: stuck + reason + questions.
		const lock = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock).toBeDefined();
		expect(lock?.state).toBe('stuck');
		expect(lock?.action).toBe('implement');
		expect(lock?.reason).toMatch(/acceptance gate failed \(exit 1\)/);
		expect(lock?.questions).toContain('relax the lint rule, or fix the code?');
	});

	it('the tree-less surface (after-commit path) is ALSO a pure lock amend', async () => {
		// The after-commit / ledger-only surface (continue-push-failure /
		// continue-rebase-conflict): the work is already committed on the kept branch.
		// It is now the SAME pure lock amend (no folder move).
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

		const lock = await readItemLock({
			item: 'task:beta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock?.state).toBe('stuck');
		expect(lock?.reason).toMatch(/continue rebase conflict/);
	});

	it('a bounce with NO held lock reports moved:false (no folder to fall back to)', async () => {
		// An item that predates the lock (or a flow where claim never acquired): the
		// mark-stuck finds no lock (`not-held`). With the folder retired there is no
		// other substrate to record the stuck state on, so the bounce HONESTLY reports
		// it did not land (the caller retries/resolves) rather than fake a success.
		const seeded = seedRepoWithArbiter(scratch.root, ['gamma']);
		const repo = seeded.repo;
		// Sit on a work branch with NO lock held (no performClaim).
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', 'work/task-gamma', `${ARBITER}/main`], repo);

		const result = await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'gamma',
			reason: 'agent failed',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/no held lock/i);
		// No needs-attention/ folder file is ever written, and no lock is created
		// (mark-stuck is `active → stuck` only, not `absent → stuck`).
		expect(existsOnArbiterMain(repo, 'needs-attention', 'gamma')).toBe(false);
		const lock = await readItemLock({
			item: 'task:gamma',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock).toBeUndefined();
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
		// what this slice introduces; the lock amend touches ONLY the lock ref, so it
		// never corrupts the `main` durable record.
		const {repo, seeded} = await claimAndBranch('epsilon');

		// Seed a durable `done` record on main (a just-completed item), via a clone so
		// the checkout-under-test is untouched. The `implement` lock claim acquired is
		// still HELD (interim: complete does not yet release it — slice #7).
		const completer = seeded.clone('completer');
		gitIn(['fetch', '-q', ARBITER], completer);
		gitIn(['switch', '-q', '-C', 'done-move', `${ARBITER}/main`], completer);
		mkdirSync(join(completer, 'work', 'tasks', 'done'), {recursive: true});
		gitIn(
			['mv', 'work/tasks/todo/epsilon.md', 'work/tasks/done/epsilon.md'],
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

	it('the full bounce of a done item marks the lock stuck (pure lock amend; main untouched)', async () => {
		// End-to-end via the seam: a rebase-conflict bounce of a JUST-COMPLETED item.
		// The done record on main co-exists with the stuck lock (US #10) and the bounce
		// is a PURE lock amend — it touches ONLY the lock ref, never the on-main record.
		const {repo, seeded} = await claimAndBranch('zeta');
		// Seed a durable `done` record on main via a clone (the checkout-under-test
		// holds the still-held implement lock).
		const completer = seeded.clone('zeta-completer');
		gitIn(['fetch', '-q', ARBITER], completer);
		gitIn(['switch', '-q', '-C', 'done-move', `${ARBITER}/main`], completer);
		mkdirSync(join(completer, 'work', 'tasks', 'done'), {recursive: true});
		gitIn(
			['mv', 'work/tasks/todo/zeta.md', 'work/tasks/done/zeta.md'],
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
		expect(result.moved).toBe(true);

		// The held lock is stuck (the human's attention)…
		const lock = await readItemLock({
			item: 'task:zeta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock?.state).toBe('stuck');
		expect(lock?.reason).toMatch(/conflict/i);
		// …and the `done` record on main is UNTOUCHED (the lock amend never writes main):
		// done + stuck co-exist (US #10), and no needs-attention/ folder is written.
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
	opts: {stuck?: string; action?: 'implement' | 'slice' | 'advance'} = {},
): Promise<void> {
	const src = mirrorSrc(workspacesDir(), name);
	const clone = join(scratch.root, `lock-seeder-${name}-${slug}`);
	gitIn(['clone', '-q', `file://${src}`, clone], scratch.root);
	gitIn(['remote', 'add', 'arbiter', `file://${src}`], clone);
	gitIn(['fetch', '-q', 'arbiter'], clone);
	// The identity NAMESPACE is `slice:` (what the bounce surfaces); the lock ACTION
	// axis (`implement`/`slice`/`advance`) is a SEPARATE field passed to acquire.
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
	return join(scratch.root, '.agent-runner');
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
