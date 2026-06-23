import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {performComplete} from '../src/complete.js';
import {performClaim} from '../src/claim-cas.js';
import {
	acquireItemLock,
	markStuckItemLock,
	readItemLock,
	reconcileItemLockAgainstMain,
	itemLockRef,
	terminalMainPaths,
} from '../src/item-lock.js';
import {run} from '../src/git.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	briefFile,
	type Scratch,
	fixtureFolderRel,
} from './helpers/gitRepo.js';

const ARBITER = 'arbiter';
const PASS = 'exit 0';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-complete-lock-crash-');
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

/** Stand a repo up as the loop leaves it just before `complete`: a slice
 * claimed (lock held + body in-progress on the arbiter) and the human onboarded
 * onto `work/task-<slug>` off the freshly-pushed main. */
async function claimAndBranch(slug: string) {
	const seeded = seedRepoWithArbiter(scratch.root, [slug]);
	const repo = seeded.repo;
	const claim = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
	return {seeded, repo, arbiter: seeded.arbiter};
}

/** The build agent's UNCOMMITTED work (the runner stages it with the done-move). */
function agentEdits(repo: string, file = 'feature.txt', body = 'the work\n') {
	writeFileSync(join(repo, file), body);
}

/** Push a `work/<folder>/<slug>.md` straight onto `<arbiter>/main` via a throwaway
 * clone (simulating a durable terminal record landing without the lock release —
 * i.e. a crash BETWEEN the main move and the release). */
function seedTerminalOnArbiter(
	arbiter: string,
	folder: string,
	slug: string,
	seed = `${folder}: ${slug}`,
): void {
	const dest = join(scratch.root, `seed-term-${folder}-${slug}`);
	const env = gitEnv();
	run('git', ['clone', '-q', `file://${arbiter}`, dest], scratch.root, {env});
	run('git', ['checkout', '-q', '-B', `seed/${slug}`, 'origin/main'], dest, {
		env,
	});
	const dir = join(dest, 'work', fixtureFolderRel(folder));
	mkdirSync(dir, {recursive: true});
	writeFileSync(join(dir, `${slug}.md`), seed + '\n');
	run('git', ['add', '-A'], dest, {env});
	run('git', ['commit', '-q', '-m', seed], dest, {env});
	run('git', ['push', '-q', 'origin', `seed/${slug}:main`], dest, {env});
	rmSync(dest, {recursive: true, force: true});
}

describe('complete — cross-substrate crash-safety (hold → durable main move → release)', () => {
	it('orders the durable main move FIRST and the lock release SECOND, leaving NO held lock', async () => {
		const {repo, arbiter} = await claimAndBranch('alpha');
		// The lock claim took is held BEFORE complete runs (in-flight).
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(true);
		agentEdits(repo);

		const result = await performComplete({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		// The DURABLE main move landed (in-progress → done) — the authoritative record.
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		// And the per-item lock is RELEASED (SECOND) — no stranded lock after a
		// clean completion.
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(false);
	});

	it('still completes (and releases) on the propose path', async () => {
		const {repo, arbiter} = await claimAndBranch('beta');
		agentEdits(repo);

		const result = await performComplete({
			slug: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			noPR: true,
			noSwitch: true,
			verify: PASS,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		// Propose mode lands the durable done-move on the PUSHED work BRANCH (it
		// awaits a PR merge, NOT on `main` yet) — the in-flight hold is done, so the
		// per-item lock is RELEASED here exactly as on the merge path.
		const onBranch = run(
			'git',
			['cat-file', '-e', 'HEAD:work/tasks/done/beta.md'],
			repo,
			{env: gitEnv()},
		);
		expect(onBranch.status).toBe(0);
		expect(existsOnArbiterMain(repo, 'done', 'beta')).toBe(false);
		expect(lockRefOnArbiter(arbiter, 'task-beta')).toBe(false);
	});

	it('a FAILED gate does NOT release the lock (the item is still in flight, routed stuck)', async () => {
		const {repo, arbiter} = await claimAndBranch('gamma');
		agentEdits(repo);

		const result = await performComplete({
			slug: 'gamma',
			cwd: repo,
			arbiter: ARBITER,
			verify: 'exit 1',
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('gate-failed');
		// The durable done-move did NOT happen, and complete did NOT release the
		// lock on the failure path — the needs-attention seam owns the lock's
		// state (mark-stuck), the item is still in flight.
		expect(existsOnArbiterMain(repo, 'done', 'gamma')).toBe(false);
		expect(lockRefOnArbiter(arbiter, 'task-gamma')).toBe(true);
	});
});

describe('reconcileItemLockAgainstMain — the main record is authoritative over a stale lock', () => {
	it('clears a stale ACTIVE lock when main shows the item done (crash between move and release)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['delta']);
		// Simulate the crash: the durable done-move landed on main FIRST, but the
		// release never ran (the process died between them), so the lock lingers.
		await acquireItemLock({
			item: 'task:delta',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		seedTerminalOnArbiter(arbiter, 'done', 'delta');
		expect(lockRefOnArbiter(arbiter, 'task-delta')).toBe(true);

		const rec = await reconcileItemLockAgainstMain({
			item: 'task:delta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(rec.outcome).toBe('cleared-stale');
		expect(rec.terminalOnMain).toBe(true);
		// Recovery CONVERGED: the stale lock is gone, the durable record stands.
		expect(lockRefOnArbiter(arbiter, 'task-delta')).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'delta')).toBe(true);
	});

	it('clears a stale ACTIVE lock when main shows the slice cancelled (the slice regime terminal)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['epsilon']);
		await acquireItemLock({
			item: 'task:epsilon',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		seedTerminalOnArbiter(arbiter, 'cancelled', 'epsilon');

		const rec = await reconcileItemLockAgainstMain({
			item: 'task:epsilon',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(rec.outcome).toBe('cleared-stale');
		expect(lockRefOnArbiter(arbiter, 'task-epsilon')).toBe(false);
	});

	it('clears a stale ACTIVE PRD lock when main shows the PRD prd-sliced', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['z'], {
			briefs: ['zeta'],
		});
		await acquireItemLock({
			item: 'brief:zeta',
			action: 'task',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		seedTerminalOnArbiter(arbiter, 'prd-sliced', 'zeta', briefFile('zeta'));

		const rec = await reconcileItemLockAgainstMain({
			item: 'brief:zeta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(rec.outcome).toBe('cleared-stale');
		expect(lockRefOnArbiter(arbiter, 'brief-zeta')).toBe(false);
	});

	it('KEEPS a STUCK lock that co-exists with a done record (not corruption — US #10)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['eta']);
		await acquireItemLock({
			item: 'task:eta',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		// A rebase-conflict bounce marks a just-completed item stuck.
		const stuck = await markStuckItemLock({
			item: 'task:eta',
			reason: 'rebase-conflict bounce of a just-completed item',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(stuck.outcome).toBe('transitioned');
		seedTerminalOnArbiter(arbiter, 'done', 'eta');

		const rec = await reconcileItemLockAgainstMain({
			item: 'task:eta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		// done + stuck CO-EXIST: the stuck lock wins the human's attention, the
		// main record wins dependency resolution — NOT flagged as corruption.
		expect(rec.outcome).toBe('kept-stuck');
		expect(rec.terminalOnMain).toBe(true);
		expect(lockRefOnArbiter(arbiter, 'task-eta')).toBe(true);
		const entry = await readItemLock({
			item: 'task:eta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(entry?.state).toBe('stuck');
		expect(entry?.reason).toContain('rebase-conflict');
	});

	it('leaves a held lock untouched when main is NOT terminal (the normal in-flight state)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['theta']);
		await acquireItemLock({
			item: 'task:theta',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		// No terminal record on main — the item is genuinely in flight.

		const rec = await reconcileItemLockAgainstMain({
			item: 'task:theta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(rec.outcome).toBe('kept-in-flight');
		expect(rec.terminalOnMain).toBe(false);
		expect(lockRefOnArbiter(arbiter, 'task-theta')).toBe(true);
	});

	it('is idempotent — no lock to reconcile is a clean no-op', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['iota']);
		const rec = await reconcileItemLockAgainstMain({
			item: 'task:iota',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(rec.outcome).toBe('no-lock');
	});

	it('converges a simulated crash: claim → durable move (no release) → recover', async () => {
		// END-TO-END crash simulation. Claim takes the lock + moves the body; we
		// then land the durable done-move on main WITHOUT releasing the lock (the
		// crash). Recovery clears the stranded lock; re-running is a clean no-op.
		const {repo, arbiter} = await claimAndBranch('kappa');
		expect(lockRefOnArbiter(arbiter, 'task-kappa')).toBe(true);
		// The durable move lands on main, but the lock release never runs (crash).
		seedTerminalOnArbiter(arbiter, 'done', 'kappa');

		const first = await reconcileItemLockAgainstMain({
			item: 'task:kappa',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(first.outcome).toBe('cleared-stale');
		expect(lockRefOnArbiter(arbiter, 'task-kappa')).toBe(false);

		const second = await reconcileItemLockAgainstMain({
			item: 'task:kappa',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(second.outcome).toBe('no-lock');
	});

	it('maps each type to its PER-REGIME durable terminal main paths', () => {
		// A slice: done OR the slice regime's won't-proceed terminal (tasks/cancelled).
		expect(terminalMainPaths('task', 's')).toEqual([
			'work/tasks/done/s.md',
			'work/tasks/cancelled/s.md',
		]);
		// A brief: tasked (sliced, resting) OR the brief regime's terminal
		// (briefs/dropped). A task-drop and a brief-drop sharing a slug never collide.
		expect(terminalMainPaths('brief', 'p')).toEqual([
			'work/briefs/tasked/p.md',
			'work/briefs/dropped/p.md',
		]);
		// An observation has NO durable terminal — it leaves by deletion.
		expect(terminalMainPaths('observation', 'o')).toEqual([]);
	});
});
