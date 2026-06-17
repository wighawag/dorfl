import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {performDo, type DoAgentRunner} from '../src/do.js';
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
 * Slice `do-fails-fast-when-acceptance-gate-statically-unrunnable`.
 *
 * The fresh-worktree gate runs `prepare` then `verify` in a CLEAN throwaway
 * worktree. If `prepare` resolves to no commands AND a lockfile is present, the
 * gate is STATICALLY guaranteed to fail with "command not found" before it can
 * evaluate any work. A pre-claim startup guard converts that wasted build into
 * an instant, actionable error.
 *
 * The guard is DEPS-only: there is NO "verify unset" case — `resolveVerifyCommands`
 * substitutes `DEFAULT_VERIFY_COMMAND` when `verify` is unset or all-blank, so
 * verify is NEVER statically unrunnable-because-unset. Adding a "verify unset"
 * guard would be dead code (it could never fire on a real config); these tests
 * pin the deps-only shape.
 *
 * House style: a throwaway checkout + a local `--bare` arbiter + a STUBBED
 * agent that records whether it was reached (the guard must STOP before any
 * claim/build).
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-gate-readiness-');
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

const failIfReached: DoAgentRunner = () => {
	throw new Error('the agent must not run when the static guard fires');
};

/**
 * Set the repo up the way `performComplete` expects: HEAD on the work branch,
 * the slice moved to `work/in-progress/`, and the agent's edit committed. The
 * test then calls `performComplete` and asserts the guard refuses BEFORE the
 * gate runs.
 */
function onWorkBranchWithInProgress(repo: string, slug: string): void {
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/slice-${slug}`, `${ARBITER}/main`], repo);
	mkdirSync(join(repo, 'work', 'in-progress'), {recursive: true});
	gitIn(['mv', `work/backlog/${slug}.md`, `work/in-progress/${slug}.md`], repo);
	writeFileSync(join(repo, 'agent-output.txt'), 'work\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'agent work'], repo);
}

describe('unit — checkGatePreconditions (deps-only, never verify-presence)', () => {
	it('fires when fresh gate ON + prepare unset + lockfile present', () => {
		const guard = checkGatePreconditions({
			freshWorktreeGate: true,
			prepare: undefined,
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
		// must catch BOTH (the slice's "all-blank case" criterion).
		const guard = checkGatePreconditions({
			freshWorktreeGate: true,
			prepare: ['   ', '\t', ''],
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
			lockfile: undefined,
		});
		expect(guard).toBeUndefined();
	});

	it('does NOT fire when prepare resolves to at least one command', () => {
		const guard = checkGatePreconditions({
			freshWorktreeGate: true,
			prepare: 'pnpm install --frozen-lockfile',
			lockfile: 'pnpm-lock.yaml',
		});
		expect(guard).toBeUndefined();
	});

	it('does NOT fire when fresh gate is OFF (the gate runs in the BUILD worktree, which has deps)', () => {
		const guard = checkGatePreconditions({
			freshWorktreeGate: false,
			prepare: undefined,
			lockfile: 'pnpm-lock.yaml',
		});
		expect(guard).toBeUndefined();
	});

	it('does NOT fire when fresh gate is undefined (treated like OFF for the guard — matches integration-core)', () => {
		// `integration-core.ts` reads `input.freshWorktreeGate === true` to gate the
		// throwaway worktree; the guard mirrors that.
		const guard = checkGatePreconditions({
			freshWorktreeGate: undefined,
			prepare: undefined,
			lockfile: 'pnpm-lock.yaml',
		});
		expect(guard).toBeUndefined();
	});

	it('there is NO verify-presence case — the helper takes no `verify` arg (deps-only)', () => {
		// COMPILE-TIME witness: `GatePreconditionInput` has `freshWorktreeGate`,
		// `prepare`, `lockfile` — and nothing about `verify`. The runtime call below
		// passes ONLY those three keys; if a verify-presence branch ever existed it
		// would force a fourth arg here. Documents the deps-only shape per the slice.
		const guard = checkGatePreconditions({
			freshWorktreeGate: true,
			prepare: 'pnpm install',
			lockfile: 'pnpm-lock.yaml',
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

		const scratch2 = makeScratch('agent-runner-gate-readiness-2-');
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
			// `verify` is irrelevant to the guard (deps-only); supply a passing one so
			// we are unambiguously testing the prepare-guard, not a verify failure.
			verify: 'exit 0',
			agentRunner: () => {
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
		expect(gitIn(['branch', '--list', 'work/slice-alpha'], repo).trim()).toBe(
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
			agentRunner: failIfReached,
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
			agentRunner: ({cwd}) => {
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
			agentRunner: ({cwd}) => {
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
			agentRunner: ({cwd}) => {
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
		// Claim + onboard onto work/slice-alpha (so complete has something to do).
		onWorkBranchWithInProgress(repo, 'alpha');

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
		// The slice is still in-progress in the tree (no done-move happened) and
		// not on done/ on the arbiter.
		expect(existsSync(join(repo, 'work', 'in-progress', 'alpha.md'))).toBe(
			true,
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
		onWorkBranchWithInProgress(repo, 'alpha');

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
