import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {performDo, type DoAgentRunner} from '../src/do.js';
import {performComplete, syncLocalMain} from '../src/complete.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * The main-divergence guard + the NON-FATAL local-main sync (the slice
 * `main-divergence-guard`). House style: a throwaway checkout + a local `--bare`
 * arbiter + a STUBBED agent. It drives real git AND writes `main` (the merge-mode
 * integration + the autonomous needs-attention surfacing), so it lives in the
 * non-parallel project (see vitest.config.ts RACE_SENSITIVE).
 *
 * Two parts under test:
 *   PART 1 — `complete --merge`'s local-main ff is NON-FATAL: a diverged local
 *            main can't fast-forward, but the arbiter push already defined
 *            success, so `complete` still returns `completed` / exit 0 (with a
 *            "rebase to sync" message + `localMainSynced: false`). A genuinely
 *            different sync failure is NOT masked.
 *   PART 2 — a pre-flight DIVERGENCE GUARD on in-place `do` (and `complete
 *            --merge`): a local main ahead of `<arbiter>/main` REFUSES up front,
 *            UNLESS `--ignore-diverged-main` is passed.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-divergence-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';
const PASS = 'exit 0';

function currentBranch(repo: string): string {
	return gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim();
}

/** A stubbed agent that edits a file (non-empty commit) and succeeds. */
const editingAgent: DoAgentRunner = ({cwd}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
	return {ok: true};
};

/**
 * DIVERGE the local `main`: commit a local-only change on `main` that is never
 * pushed, so `<arbiter>/main..main` is non-empty (local main is ahead). Leaves
 * HEAD on `main`. Returns the diverging commit SHA.
 */
function divergeLocalMain(repo: string, file = 'local-only.txt'): string {
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
	writeFileSync(join(repo, file), 'unpushed local work\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'local-only divergence'], repo);
	return gitIn(['rev-parse', 'main'], repo).trim();
}

describe('PART 2 — in-place `do` REFUSES on a diverged local main', () => {
	it('refuses BEFORE running the agent (no claim, no work branch) when local main is ahead', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		divergeLocalMain(repo);

		let agentRan = false;
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			agentRunner: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		expect(result.message).toMatch(/ahead of/i);
		expect(result.message).toMatch(/unpushed/i);
		// The agent NEVER ran (the build was not wasted).
		expect(agentRan).toBe(false);
		// Nothing was claimed; still in backlog; still on main.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(currentBranch(repo)).toBe('main');
		expect(gitIn(['branch', '--list', 'work/slice-alpha'], repo).trim()).toBe(
			'',
		);
	});

	it('does NOT refuse in propose mode (propose never ff’s local main, so the guard is merge-mode-only)', async () => {
		// The guard protects ONLY the paths that fast-forward local `main`, and only
		// merge mode ff's it. Propose pushes the work branch + opens a PR (the work
		// lands on <arbiter>/work/<slug>, NOT on main) and completion only switches to
		// main with no ff — a diverged local main is never touched. So a diverged main
		// must NOT block a propose-mode `do` (it would be pure friction).
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		divergeLocalMain(repo);

		let agentRan = false;
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			verify: PASS,
			agentRunner: (ctx) => {
				agentRan = true;
				return editingAgent(ctx);
			},
			env: gitEnv(),
		});

		// The pre-flight divergence guard did NOT fire: the run proceeded past it
		// (claimed + ran the agent + completed) rather than being refused with the
		// "ahead of" message. The propose flow leaves the diverged local main untouched.
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(agentRan).toBe(true);
		// It got past the guard into the claim/onboard (the lock is held; claim writes
		// nothing to main, so the body stays in backlog/, and propose does NOT land it).
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
	});
});

describe('PART 2 — `--ignore-diverged-main` overrides the guard', () => {
	it('proceeds past the guard, runs the agent, and completes exit-0 (work on the arbiter)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		divergeLocalMain(repo);

		const notes: string[] = [];
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			ignoreDivergedMain: true,
			verify: PASS,
			agentRunner: editingAgent,
			note: (m) => notes.push(m),
			env: gitEnv(),
		});

		// PART 1 + PART 2 together: the guard was bypassed, the run completed, and
		// the work landed on the arbiter even though local main stayed diverged.
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);

		// The NON-FATAL local-main sync emitted the honest "rebase to sync" message.
		const all = notes.join('\n');
		expect(all).toMatch(/rebase/i);
		expect(all).toMatch(/diverged/i);
	});
});

describe('PART 1 — `complete --merge` local-main ff is NON-FATAL on a diverged main', () => {
	it('still returns completed / exit 0 with localMainSynced:false and a rebase message', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['delta']);
		const repo = seeded.repo;

		// Claim + onboard onto the work branch (the human loop's pre-complete state).
		const claim = await performClaim({
			slug: 'delta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', 'work/slice-delta', `${ARBITER}/main`], repo);

		// DIVERGE local main AFTER branching (an unpushed commit on main only), then
		// return to the work branch and leave the agent's uncommitted work there.
		const divergeSha = divergeLocalMain(repo);
		gitIn(['switch', '-q', 'work/slice-delta'], repo);
		writeFileSync(join(repo, 'thing.txt'), 'merged work\n');

		const notes: string[] = [];
		const result = await performComplete({
			slug: 'delta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			// The guard would refuse up front; --ignore-diverged-main reaches the ff.
			ignoreDivergedMain: true,
			verify: PASS,
			note: (m) => notes.push(m),
			env: gitEnv(),
		});

		// SUCCESS is defined by the authoritative arbiter push, NOT the local ff.
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(result.mergedToMain).toBe(true);
		// The local sync was SKIPPED (the diverged main could not fast-forward).
		expect(result.localMainSynced).toBe(false);

		// The work landed on the arbiter's main, in done/.
		expect(existsOnArbiterMain(repo, 'done', 'delta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'delta')).toBe(false);

		// The operator was told to rebase to sync.
		const all = notes.join('\n') + '\n' + result.message;
		expect(all).toMatch(/rebase/i);
		expect(all).toMatch(/diverged/i);

		// Local main was LEFT diverged (the operator's to reconcile) — it still
		// carries the unpushed commit, NOT the arbiter's just-merged tip.
		expect(currentBranch(repo)).toBe('main');
		expect(gitIn(['rev-parse', 'main'], repo).trim()).toBe(divergeSha);
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(gitIn(['rev-parse', `${ARBITER}/main`], repo).trim()).not.toBe(
			divergeSha,
		);
	});
});

describe('PART 1 — a genuinely different sync failure is NOT masked', () => {
	it('syncLocalMain THROWS on a non-divergence failure (e.g. an unreachable arbiter fetch)', async () => {
		// The softening is SCOPED to the ff step (merge --ff-only). The `fetch` and
		// `switch` stay HARD: a genuinely different failure must still surface, not be
		// swallowed as a non-fatal skip. Drive `syncLocalMain` directly against an
		// UNKNOWN remote name so its first step (`git fetch <bad>`) fails — it MUST
		// reject (not resolve `false`).
		const {repo} = seedRepoWithArbiter(scratch.root, ['gamma']);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);

		await expect(
			syncLocalMain(repo, 'no-such-remote', gitEnv(), () => {}),
		).rejects.toThrow(/git fetch/i);
	});

	it('syncLocalMain returns false (non-fatal) ONLY for the diverged/ff-cannot-apply case', async () => {
		// The positive boundary: a TRULY diverged local main (local has an unpushed
		// commit AND the arbiter advanced beyond it) is softened to `false`, while a
		// clean ff returns `true`.
		const seeded = seedRepoWithArbiter(scratch.root, ['gamma']);
		const repo = seeded.repo;

		// Clean path first: local main at the arbiter tip → ff is a no-op → true.
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
		const cleaned = await syncLocalMain(repo, ARBITER, gitEnv(), () => {});
		expect(cleaned).toBe(true);

		// Now build a GENUINE divergence: an unpushed local commit on main, AND the
		// arbiter advanced (from another clone) beyond the shared base — so the two
		// histories have diverged and `merge --ff-only` cannot apply.
		divergeLocalMain(repo); // local-only commit on main
		const other = seeded.clone('mover');
		writeFileSync(join(other, 'arbiter-advance.txt'), 'remote work\n');
		gitIn(['add', '-A'], other);
		gitIn(['commit', '-q', '-m', 'arbiter advance'], other);
		gitIn(['push', '-q', ARBITER, 'main:main'], other);

		const notes: string[] = [];
		const diverged = await syncLocalMain(repo, ARBITER, gitEnv(), (m) =>
			notes.push(m),
		);
		expect(diverged).toBe(false);
		expect(notes.join('\n')).toMatch(/rebase/i);
	});
});

describe('the NORMAL (non-diverged) path still ff’s local main exactly as today', () => {
	it('in-place `do --merge` lands work on the arbiter AND ends on an up-to-date local main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// No divergence: the guard passes, the run completes, local main ff's.
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);

		// Local main ff'd to the arbiter's just-merged tip (the ergonomic finish).
		expect(currentBranch(repo)).toBe('main');
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(gitIn(['rev-parse', 'main'], repo).trim()).toBe(
			gitIn(['rev-parse', `${ARBITER}/main`], repo).trim(),
		);
	});

	it('`complete --merge` reports localMainSynced:true on the clean path', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['epsilon']);
		const repo = seeded.repo;
		const claim = await performClaim({
			slug: 'epsilon',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(
			['switch', '-q', '-c', 'work/slice-epsilon', `${ARBITER}/main`],
			repo,
		);
		writeFileSync(join(repo, 'thing.txt'), 'work\n');

		const result = await performComplete({
			slug: 'epsilon',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(result.localMainSynced).toBe(true);
		// And local main really did ff.
		expect(currentBranch(repo)).toBe('main');
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(gitIn(['rev-parse', 'main'], repo).trim()).toBe(
			gitIn(['rev-parse', `${ARBITER}/main`], repo).trim(),
		);
	});
});

describe('PART 2 — `complete --merge` REFUSES up front on a diverged main (no override)', () => {
	it('refuses before the gate when local main is ahead, unless --ignore-diverged-main', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['zeta']);
		const repo = seeded.repo;
		const claim = await performClaim({
			slug: 'zeta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', 'work/slice-zeta', `${ARBITER}/main`], repo);
		divergeLocalMain(repo);
		gitIn(['switch', '-q', 'work/slice-zeta'], repo);
		writeFileSync(join(repo, 'thing.txt'), 'work\n');

		const result = await performComplete({
			slug: 'zeta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		expect(result.message).toMatch(/ahead of/i);
		// Nothing landed: the body still rests in backlog/ on the arbiter, not done
		// (claim wrote nothing to main; the refusal happened before any done-move).
		expect(existsOnArbiterMain(repo, 'backlog', 'zeta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'zeta')).toBe(false);
		// The agent's uncommitted work is untouched (no done-move, no commit).
		expect(existsSync(join(repo, 'thing.txt'))).toBe(true);
	});

	it('a diverged main in PROPOSE mode is NOT guarded (propose never ff’s local main)', async () => {
		// Scope: the complete-path guard is merge-mode only (propose just switches to
		// main, no ff). A diverged main must NOT block a propose completion.
		const seeded = seedRepoWithArbiter(scratch.root, ['eta']);
		const repo = seeded.repo;
		const claim = await performClaim({
			slug: 'eta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', 'work/slice-eta', `${ARBITER}/main`], repo);
		divergeLocalMain(repo);
		gitIn(['switch', '-q', 'work/slice-eta'], repo);
		writeFileSync(join(repo, 'thing.txt'), 'work\n');

		const result = await performComplete({
			slug: 'eta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			verify: PASS,
			env: gitEnv(),
		});
		// Propose completes (pushes the branch); the diverged main is irrelevant.
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
	});
});
