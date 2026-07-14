import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync} from 'node:fs';
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
	specFile,
	type Scratch,
	fixtureFolderRel,
	rmrf,
} from './helpers/gitRepo.js';

const ARBITER = 'arbiter';
const PASS = 'exit 0';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-complete-lock-crash-');
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

/** Stand a repo up as the loop leaves it just before `complete`: a task
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
	rmrf(dest);
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

	it('propose path KEEPS the lock HELD (work is on the PR branch, NOT on main) until the PR merges', async () => {
		// REGRESSION for `propose-keep-lock-until-pr-merge`: a successful propose
		// complete lands the done-move on the PUSHED work BRANCH (awaiting a PR merge),
		// NOT on `main`. The body therefore still rests in `tasks/ready/` on
		// `<arbiter>/main`. If the lock were RELEASED here the task would be both
		// unlocked AND still in the pool, so the next advance tick would re-claim it
		// (lock absent), rebuild, the PR would merge, the diff would be empty, and the
		// item would be mis-marked `stuck`. So the lock MUST stay HELD: the open PR is
		// the in-flight state; the lock is released only when the work lands on `main`.
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
		// The done-move is on the pushed work BRANCH, NOT on `main`.
		const onBranch = run(
			'git',
			['cat-file', '-e', 'HEAD:work/tasks/done/beta.md'],
			repo,
			{env: gitEnv()},
		);
		expect(onBranch.status).toBe(0);
		expect(existsOnArbiterMain(repo, 'done', 'beta')).toBe(false);
		// The body still rests in the pool on `main` (claim no longer moves it; the
		// propose done-move has not landed on main). The `backlog` fixture word maps
		// to the `tasks/ready/` pool folder.
		expect(existsOnArbiterMain(repo, 'backlog', 'beta')).toBe(true);
		// THE FIX: the per-item lock is KEPT HELD (not released at PR-open), so the
		// held-slug subtraction keeps the in-flight task out of the eligible pool for
		// the whole review window.
		expect(lockRefOnArbiter(arbiter, 'task-beta')).toBe(true);
	});

	it('a FAILED gate SURFACES on <arbiter>/main then RELEASES the lock (PR-2b: bounce = surface-then-release)', async () => {
		const {repo, arbiter} = await claimAndBranch('gamma');
		agentEdits(repo);

		const result = await performComplete({
			slug: 'gamma',
			cwd: repo,
			arbiter: ARBITER,
			verify: 'exit 1',
			surfaceArbiter: ARBITER,
			env: gitEnv(),
		});

		// PR-2b D3: a clean-surface bounce is GREEN (exit 0). The durable done-move
		// did NOT happen. Post-PR-2b (spec
		// `surface-stuck-as-questions-and-retire-stuck-lock-state`), a gate-failed
		// bounce SURFACES the item on `<arbiter>/main` (sidecar + `needsAnswers:true`
		// in ONE commit) THEN RELEASES the per-item lock, so the item rests as a
		// `needsAnswers:true` pool item (`eligible:false`) rather than a held stuck
		// lock.
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('gate-failed');
		expect(existsOnArbiterMain(repo, 'done', 'gamma')).toBe(false);
		expect(lockRefOnArbiter(arbiter, 'task-gamma')).toBe(false);
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

	it('clears a stale ACTIVE lock when main shows the task cancelled (the task regime terminal)', async () => {
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

	it('clears a stale ACTIVE SPEC lock when main shows the SPEC specs-tasked', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['z'], {
			specs: ['zeta'],
		});
		await acquireItemLock({
			item: 'spec:zeta',
			action: 'task',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		seedTerminalOnArbiter(arbiter, 'prd-tasked', 'zeta', specFile('zeta'));

		const rec = await reconcileItemLockAgainstMain({
			item: 'spec:zeta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(rec.outcome).toBe('cleared-stale');
		expect(lockRefOnArbiter(arbiter, 'spec-zeta')).toBe(false);
	});

	it('CLEARS a STUCK lock that has become a crash-orphan over a terminal-on-main item (task `reaper-reap-terminal-stuck-lock-orphans`; ADR `ledger-status-on-per-item-lock-refs` § Addendum 2026-07-10)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['eta']);
		await acquireItemLock({
			item: 'task:eta',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		// A rebase-conflict bounce marks a just-completed item stuck (`done` +
		// `stuck` may LEGITIMATELY co-exist during the bounce, US #10) — but by
		// the time we reconcile the item has reached its terminal folder on `main`
		// (by any path: human finish, re-drive, manual fixup+merge), so the
		// remaining stuck lock is a CRASH-ORPHAN the durable `main` record supersedes.
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

		// The `main` record is authoritative over an ORPHAN lock: reconcile
		// clears the stuck-terminal orphan via the SAME leased delete
		// `release-lock` / the recovery use for `cleared-stale`. The narrow
		// invariant preserved is that stuck + NON-terminal STILL keeps (see the
		// dedicated pin below).
		expect(rec.outcome).toBe('cleared-stuck-terminal');
		expect(rec.terminalOnMain).toBe(true);
		expect(lockRefOnArbiter(arbiter, 'task-eta')).toBe(false);
	});

	it('KEEPS a STUCK lock over a NON-terminal item — the genuine human-attention case (contract fence for `reaper-reap-terminal-stuck-lock-orphans`)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['eta2']);
		await acquireItemLock({
			item: 'task:eta2',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		const stuck = await markStuckItemLock({
			item: 'task:eta2',
			reason: 'genuine build failure requiring human attention',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(stuck.outcome).toBe('transitioned');
		// NO terminal record on main — the item is genuinely in flight and stuck.

		const rec = await reconcileItemLockAgainstMain({
			item: 'task:eta2',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		// Non-terminal + stuck STILL keeps — the invariant the contract loosening
		// MUST preserve. Never auto-cleared.
		expect(rec.outcome).toBe('kept-stuck');
		expect(rec.terminalOnMain).toBe(false);
		expect(lockRefOnArbiter(arbiter, 'task-eta2')).toBe(true);
		const entry = await readItemLock({
			item: 'task:eta2',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(entry?.state).toBe('stuck');
		expect(entry?.reason).toContain('genuine build failure');
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
		// A task: done OR the task regime's won't-proceed terminal (tasks/cancelled).
		expect(terminalMainPaths('task', 's')).toEqual([
			'work/tasks/done/s.md',
			'work/tasks/cancelled/s.md',
		]);
		// A spec: tasked (tasked, resting) OR the spec regime's terminal
		// (specs/dropped). A task-drop and a spec-drop sharing a slug never collide.
		// HARD CUTOVER: the legacy `'prd'` type is GONE — only `'spec'` maps here.
		expect(terminalMainPaths('spec', 'p')).toEqual([
			'work/specs/tasked/p.md',
			'work/specs/dropped/p.md',
		]);
		// An observation has NO durable terminal — it leaves by deletion.
		expect(terminalMainPaths('observation', 'o')).toEqual([]);
	});
});
