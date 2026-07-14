import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {performDo, type DoDorfl} from '../src/do.js';
import {performComplete} from '../src/complete.js';
import {
	checkGatePreconditions,
	detectLockfileOnDisk,
} from '../src/gate-readiness.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * Task `do-fails-fast-when-acceptance-gate-statically-unrunnable`.
 *
 * The fresh-worktree gate runs `prepare` then `verify` in a CLEAN throwaway
 * worktree. If `prepare` resolves to no commands AND a lockfile is present, the
 * gate is STATICALLY guaranteed to fail with "command not found" before it can
 * evaluate any work. A pre-claim startup guard converts that wasted build into
 * an instant, actionable error.
 *
 * The guard has TWO axes: (1) the DEPS axis (fresh gate ON + no `prepare` +
 * lockfile present ⇒ the throwaway worktree cannot install), and (2) the
 * VERIFY-UNSET axis — Dorfl has NO default gate, so a repo with no `verify`
 * declared can never pass an acceptance gate in ANY mode; that is a
 * MODE-INDEPENDENT static stop checked before the deps axis. These tests pin
 * both shapes. (The deps-axis tests below therefore always pass a valid
 * `verify` so they isolate the deps behaviour.)
 *
 * House style: a throwaway checkout + a local `--bare` arbiter + a STUBBED
 * agent that records whether it was reached (the guard must STOP before any
 * claim/build).
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-gate-readiness-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/** Commit a lockfile onto main so the seeded repo "needs an install". */
function seedLockfile(repo: string, basename = 'pnpm-lock.yaml'): void {
	writeFileSync(join(repo, basename), 'lockfileVersion: 9\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `seed ${basename}`], repo);
	gitIn(['push', '-q', ARBITER, 'main'], repo);
}

const failIfReached: DoDorfl = () => {
	throw new Error('the agent must not run when the static guard fires');
};

/**
 * Set the repo up the way `performComplete` expects: HEAD on the work branch
 * with the agent's edit committed, and the task body RESTING in the pool
 * (`work/tasks/ready/`). Post the per-item-lock cutover, a claimed-and-in-flight
 * item is NOT moved to a `work/in-progress/` folder (that folder is retired,
 * task `finish-in-progress-folder-cutover-remove-legacy-recovery-readers`): the
 * body stays in the pool and liveness is the held lock, so `complete` resolves
 * its source from `tasks/ready/`. The test then calls `performComplete` and
 * asserts the guard refuses BEFORE the gate runs.
 */
function onWorkBranchWithBody(repo: string, slug: string): void {
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
	writeFileSync(join(repo, 'agent-output.txt'), 'work\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'agent work'], repo);
}

// A valid gate the deps-axis tests use so an unset `verify` never trips the
// (higher-priority) verify-unset stop and masks the deps behaviour.
const VALID_VERIFY = 'pnpm -r build && pnpm -r test';

describe('unit — checkGatePreconditions (deps axis)', () => {
	it('fires when fresh gate ON + prepare unset + lockfile present', () => {
		const guard = checkGatePreconditions({
			freshWorktreeGate: true,
			prepare: undefined,
			verify: VALID_VERIFY,
			lockfile: 'pnpm-lock.yaml',
		});
		expect(guard).toBeDefined();
		expect(guard!.lockfile).toBe('pnpm-lock.yaml');
		// The message names the lockfile AND the two ways out.
		expect(guard!.message).toMatch(/pnpm-lock\.yaml/);
		expect(guard!.message).toMatch(/prepare/);
		expect(guard!.message).toMatch(/--no-fresh-worktree-gate/);
	});

	it('fires when fresh gate ON + prepare ALL-BLANK list + lockfile present (the resolvePrepareCommands empty case)', () => {
		// `resolvePrepareCommands` drops blank entries — both `undefined` AND a
		// list whose every entry is whitespace resolve to NO commands. The guard
		// must catch BOTH (the task's "all-blank case" criterion).
		const guard = checkGatePreconditions({
			freshWorktreeGate: true,
			prepare: ['   ', '\t', ''],
			verify: VALID_VERIFY,
			lockfile: 'pnpm-lock.yaml',
		});
		expect(guard).toBeDefined();
	});

	it('does NOT fire when no lockfile (the intentional dep-free case is preserved)', () => {
		// `prepare` unset is a DELIBERATE no-op for a repo with no deps — never a
		// default install. The guard MUST NOT fire here; it would regress that
		// design point.
		const guard = checkGatePreconditions({
			freshWorktreeGate: true,
			prepare: undefined,
			verify: VALID_VERIFY,
			lockfile: undefined,
		});
		expect(guard).toBeUndefined();
	});

	it('does NOT fire when prepare resolves to at least one command', () => {
		const guard = checkGatePreconditions({
			freshWorktreeGate: true,
			prepare: 'pnpm install --frozen-lockfile',
			verify: VALID_VERIFY,
			lockfile: 'pnpm-lock.yaml',
		});
		expect(guard).toBeUndefined();
	});

	it('does NOT fire when fresh gate is OFF (the gate runs in the BUILD worktree, which has deps)', () => {
		const guard = checkGatePreconditions({
			freshWorktreeGate: false,
			prepare: undefined,
			verify: VALID_VERIFY,
			lockfile: 'pnpm-lock.yaml',
		});
		expect(guard).toBeUndefined();
	});

	it('does NOT fire when fresh gate is undefined (treated like OFF for the deps axis — matches integration-core)', () => {
		// `integration-core.ts` reads `input.freshWorktreeGate === true` to gate the
		// throwaway worktree; the guard mirrors that.
		const guard = checkGatePreconditions({
			freshWorktreeGate: undefined,
			prepare: undefined,
			verify: VALID_VERIFY,
			lockfile: 'pnpm-lock.yaml',
		});
		expect(guard).toBeUndefined();
	});
});

describe('unit — checkGatePreconditions (verify-unset axis, MODE-INDEPENDENT)', () => {
	it('fires when verify is unset, regardless of the fresh-worktree gate', () => {
		for (const freshWorktreeGate of [true, false, undefined]) {
			const guard = checkGatePreconditions({
				freshWorktreeGate,
				prepare: 'pnpm install',
				verify: undefined,
				lockfile: undefined,
			});
			expect(
				guard,
				`freshWorktreeGate=${String(freshWorktreeGate)}`,
			).toBeDefined();
			expect(guard!.message).toMatch(/no `verify` gate is configured/);
			// Not a lockfile failure — the verify-unset failure names no lockfile.
			expect(guard!.lockfile).toBeUndefined();
		}
	});

	it('fires when verify is an all-blank list (no vacuous default)', () => {
		const guard = checkGatePreconditions({
			freshWorktreeGate: true,
			prepare: 'pnpm install',
			verify: ['', '   '],
			lockfile: 'pnpm-lock.yaml',
		});
		expect(guard).toBeDefined();
		expect(guard!.message).toMatch(/no `verify` gate is configured/);
	});

	it('takes PRIORITY over the deps axis (verify-unset is reported first)', () => {
		// Both axes would fire (fresh gate ON + no prepare + lockfile AND verify
		// unset); the verify-unset stop is checked first, so its message wins.
		const guard = checkGatePreconditions({
			freshWorktreeGate: true,
			prepare: undefined,
			verify: undefined,
			lockfile: 'pnpm-lock.yaml',
		});
		expect(guard).toBeDefined();
		expect(guard!.message).toMatch(/no `verify` gate is configured/);
	});

	it('does NOT fire when a valid verify is declared', () => {
		const guard = checkGatePreconditions({
			freshWorktreeGate: false,
			prepare: 'pnpm install',
			verify: VALID_VERIFY,
			lockfile: undefined,
		});
		expect(guard).toBeUndefined();
	});
});

describe('unit — detectLockfileOnDisk (which lockfile is named)', () => {
	it('detects pnpm-lock.yaml at the repo root', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		seedLockfile(repo, 'pnpm-lock.yaml');
		expect(detectLockfileOnDisk(repo)).toBe('pnpm-lock.yaml');
	});

	it('returns undefined for a dep-free repo (no lockfile)', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		expect(detectLockfileOnDisk(repo)).toBeUndefined();
	});

	it('detects package-lock.json + yarn.lock too (other npm-family ecosystems)', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		seedLockfile(repo, 'package-lock.json');
		expect(detectLockfileOnDisk(repo)).toBe('package-lock.json');

		const scratch2 = makeScratch('dorfl-gate-readiness-2-');
		try {
			const seeded2 = seedRepoWithArbiter(scratch2.root, ['beta']);
			seedLockfile(seeded2.repo, 'yarn.lock');
			expect(detectLockfileOnDisk(seeded2.repo)).toBe('yarn.lock');
		} finally {
			scratch2.cleanup();
		}
	});
});

describe('end-to-end — in-place `do` STOPS before claim when the gate is statically unrunnable', () => {
	it('lockfile present + no prepare + fresh gate on ⇒ refuses BEFORE claim/agent/branch', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		seedLockfile(repo);

		let agentRan = false;
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			// Fresh-worktree gate ON; NO `prepare` configured. With a lockfile present,
			// this is the statically-unrunnable case the guard must catch.
			freshWorktreeGate: true,
			// Supply a valid `verify` so we are unambiguously testing the deps/prepare
			// axis, not the (higher-priority) verify-unset stop.
			verify: 'exit 0',
			dorfl: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		// The message names the lockfile AND points at both ways out.
		expect(result.message).toMatch(/pnpm-lock\.yaml/);
		expect(result.message).toMatch(/prepare/);
		expect(result.message).toMatch(/--no-fresh-worktree-gate/);

		// Nothing happened: no claim, no work branch, no agent run.
		expect(agentRan).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(gitIn(['branch', '--list', 'work/task-alpha'], repo).trim()).toBe(
			'',
		);
	});

	it('also fires for an ALL-BLANK `prepare` list (resolvePrepareCommands ⇒ []) — the all-blank case is pinned', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		seedLockfile(repo);

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			freshWorktreeGate: true,
			// All-blank entries resolve to NO commands via `resolvePrepareCommands`.
			prepare: ['   ', '\t'],
			verify: 'exit 0',
			dorfl: failIfReached,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		expect(result.message).toMatch(/pnpm-lock\.yaml/);
	});

	it('NO lockfile + no prepare ⇒ proceeds (the intentional dep-free case is preserved)', async () => {
		// THE non-regression: a repo that genuinely has no deps must NOT trip the
		// guard. `prepare` unset is a deliberate no-op there; the throwaway
		// worktree runs `verify` against a repo that needs no install.
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// No lockfile seeded.
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			freshWorktreeGate: true,
			verify: 'exit 0',
			dorfl: ({cwd}) => {
				writeFileSync(join(cwd, 'agent-output.txt'), 'work\n');
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
	});

	it('`--no-fresh-worktree-gate` (freshWorktreeGate: false) clears the guard even with no prepare + a lockfile', async () => {
		// When the gate is OFF the acceptance gate runs in the BUILD worktree
		// (which HAS deps after the agent + install on the operator's machine),
		// so the throwaway-worktree reasoning does not apply.
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		seedLockfile(repo);

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			freshWorktreeGate: false,
			verify: 'exit 0',
			dorfl: ({cwd}) => {
				writeFileSync(join(cwd, 'agent-output.txt'), 'work\n');
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
	});

	it('configuring a `prepare` (e.g. pnpm install) clears the guard — the documented fix', async () => {
		// Verifies the resolution-precedence acceptance criterion: supplying
		// `prepare` (the user's fix in the live failure) clears the guard.
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		seedLockfile(repo);

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			freshWorktreeGate: true,
			// A no-op `prepare` (resolves to ONE command) is enough to clear the
			// guard — the static unrunnable case is "no commands at all".
			prepare: 'true',
			verify: 'exit 0',
			dorfl: ({cwd}) => {
				writeFileSync(join(cwd, 'agent-output.txt'), 'work\n');
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
	});
});

describe('end-to-end — `complete` STOPS before performIntegration when the gate is statically unrunnable', () => {
	it('lockfile present + no prepare + fresh gate on ⇒ refuses BEFORE the gate runs', async () => {
		// Set the repo up on a work branch with a non-empty staged change (the
		// shape `complete` expects), then call `performComplete` with the unrunnable
		// gate config — it must refuse with the precise message instead of trying
		// to run the gate in a throwaway worktree with no node_modules.
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		seedLockfile(repo);
		// Claim + onboard onto work/task-alpha (so complete has something to do).
		onWorkBranchWithBody(repo, 'alpha');

		const result = await performComplete({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			freshWorktreeGate: true,
			verify: 'exit 0',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		expect(result.message).toMatch(/pnpm-lock\.yaml/);
		expect(result.message).toMatch(/--no-fresh-worktree-gate/);
		// The task is still un-done in the tree (no done-move happened): the body
		// rests in the pool (`tasks/ready/`, the lock-based residence), not `done/`.
		expect(existsSync(join(repo, 'work', 'tasks', 'ready', 'alpha.md'))).toBe(
			true,
		);
		expect(existsSync(join(repo, 'work', 'tasks', 'done', 'alpha.md'))).toBe(
			false,
		);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
	});

	it('--skip-verify bypasses the guard (no gate to run ⇒ no precondition to check)', async () => {
		// `--skip-verify` skips the acceptance gate entirely. There is no
		// throwaway worktree, so the deps-only precondition cannot apply — the
		// guard must NOT fire (a false-positive would block the human escape
		// hatch on every lockfile-bearing repo with no `prepare`).
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		seedLockfile(repo);
		onWorkBranchWithBody(repo, 'alpha');

		const result = await performComplete({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			freshWorktreeGate: true,
			skipVerify: true,
			env: gitEnv(),
		});
		expect(result.outcome).not.toBe('refused');
		expect(result.exitCode).toBe(0);
	});
});
