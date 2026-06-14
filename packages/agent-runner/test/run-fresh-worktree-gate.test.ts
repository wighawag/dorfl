import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {runOnce, type AgentRunner} from '../src/run.js';
import {mergeConfig} from '../src/config.js';
import {scanRepoPaths} from '../src/scan.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * The `run`-FLEET fresh-worktree gate behaviour. ORIGINALLY (slice
 * `gate-on-rebased-tip-fresh-worktree`) `run` used the fresh rebased-tip gate ONLY
 * at `perRepoMax === 1` and fell back to today's in-build-worktree gate at
 * `perRepoMax > 1`, to AVOID the two PRE-EXISTING run-fleet same-repo races.
 *
 * UPDATED (slice `run-fleet-claim-integrate-and-sibling-rebase-concurrency-safe`):
 * those two races are now CLOSED on their own merits (the merge-push
 * re-rebase-and-retry + the sibling-ledger reconcile), so the `perRepoMax === 1`
 * downgrade was REMOVED — the fresh rebased-tip gate now runs on the `run` fleet at
 * ANY `perRepoMax`. The probe below therefore expects the SAME fresh-gate outcome
 * at perRepoMax 1 AND perRepoMax 2.
 *
 * The probe is a LEAK file: the agent writes a GITIGNORED file in its build
 * worktree (`cwd`), and `verify` REQUIRES it. The fresh rebased-tip gate is cut
 * from the COMMITTED tip (which gitignores the file ⇒ it is absent) and FAILS,
 * regardless of perRepoMax; today's in-build-worktree gate (only when the fresh
 * gate is explicitly OFF) runs in `cwd` and SEES the file (passes). So the gate's
 * outcome reveals WHICH gate ran:
 *   - fresh gate ON (any perRepoMax) ⇒ verify FAILS ⇒ tests-failed (the leak is closed);
 *   - fresh gate OFF ⇒ today's gate ⇒ verify PASSES ⇒ claimed-done (the file is in cwd).
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-run-freshgate-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

/**
 * An agent that gitignores a file and writes it (so it lives ONLY in the build
 * worktree, never the committed tree) plus a committed file (so the commit is
 * non-empty). A `verify` of `test -f leak-only.txt` then passes ONLY when run in
 * the build worktree (cwd), not on the committed rebased tip.
 */
const leakingAgent: AgentRunner = ({cwd, slug}) => {
	writeFileSync(join(cwd, '.gitignore'), 'leak-only.txt\n');
	writeFileSync(
		join(cwd, 'leak-only.txt'),
		'present only in the build worktree\n',
	);
	writeFileSync(join(cwd, `${slug}.txt`), `work done for ${slug}\n`);
	return {ok: true};
};

function scanProject(config: Parameters<typeof scanRepoPaths>[1]) {
	return scanRepoPaths([join(scratch.root, 'project')], config);
}

function configFor(overrides = {}) {
	return mergeConfig({
		defaultArbiter: 'arbiter',
		maxParallel: 4,
		integration: 'merge',
		agentCmd: 'true',
		verify: 'test -f leak-only.txt',
		autoBuild: true,
		freshWorktreeGate: true,
		...overrides,
	});
}

describe('run-fleet conditional — perRepoMax === 1 uses the FRESH rebased-tip gate', () => {
	it('a leak file in cwd is ABSENT from the gate (verify fails) ⇒ tests-failed (the falsely-green leak is closed)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor({perRepoMax: 1});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: leakingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		// The fresh gate ran on the rebased tip (no leak-only.txt) ⇒ verify FAILED.
		expect(result.items[0].status).toBe('tests-failed');
		expect(result.claimedAndDone).toBe(0);
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'feat')).toBe(true);
	});
});

describe('run-fleet — perRepoMax > 1 ALSO uses the FRESH rebased-tip gate (the downgrade is removed)', () => {
	it('the leak file is ABSENT from the gate at perRepoMax 2 (verify fails) ⇒ tests-failed (fresh gate runs at any parallelism)', async () => {
		// UPDATED (slice `run-fleet-claim-integrate-and-sibling-rebase-concurrency-safe`):
		// the `perRepoMax === 1` downgrade was REMOVED, so at perRepoMax 2 the FRESH
		// rebased-tip gate runs (NOT today's in-build-worktree gate). The leak file is
		// gitignored ⇒ absent from the committed rebased tip ⇒ verify FAILS, exactly as
		// at perRepoMax 1 — the falsely-green leak is closed on the run fleet too.
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor({perRepoMax: 2});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: leakingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		// The fresh gate ran on the rebased tip (no leak-only.txt) ⇒ verify FAILED.
		expect(result.items[0].status).toBe('tests-failed');
		expect(result.claimedAndDone).toBe(0);
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'feat')).toBe(true);
	});
});

describe('run-fleet conditional — --no-fresh-worktree-gate forces today’s gate even at perRepoMax 1', () => {
	it('with the flag OFF, perRepoMax 1 ALSO uses today’s in-build-worktree gate (the opt-out)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor({perRepoMax: 1, freshWorktreeGate: false});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: leakingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items[0].status).toBe('claimed-done');
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(true);
	});
});
