import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, existsSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {ledgerWrite} from '../src/ledger-write.js';
import {runOnce, type AgentRunner, type TestGate} from '../src/run.js';
import {performStart} from '../src/start.js';
import {performComplete} from '../src/complete.js';
import {performClaim} from '../src/claim-cas.js';
import {returnToBacklog} from '../src/needs-attention.js';
import {scanRepoPaths} from '../src/scan.js';
import {jobWorktreePath} from '../src/workspace.js';
import {mergeConfig} from '../src/config.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * `centralise-bounce-branch-push` — the bounce-time work-branch push lives INSIDE
 * the needs-attention seam (one operation, transition-kind-agnostic): the seam
 * pushes the supplied branch when it carries work, skips when empty, is
 * best-effort, and is SURFACE-ONLY when told to push nothing. These drive REAL
 * git against a local `--bare` arbiter and write `main`, so they live in the
 * NON-PARALLEL vitest project (vitest.config.ts RACE_SENSITIVE).
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-centralise-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/** The arbiter's sha for a full ref (e.g. `refs/heads/work/<slug>`), or ''. */
function arbiterRef(seeded: SeededRepo, ref: string): string {
	const out = gitIn(
		['ls-remote', `file://${seeded.arbiter}`, ref],
		seeded.repo,
	);
	const line = out.split('\n').find((l) => l.trim() !== '');
	return line ? line.split('\t')[0].trim() : '';
}

function arbiterHasBranch(seeded: SeededRepo, branch: string): boolean {
	return arbiterRef(seeded, `refs/heads/${branch}`) !== '';
}

/** Claim + onboard a slice onto `work/<slug>` with the agent's work in the tree. */
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
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/${slug}`, `${ARBITER}/main`], repo);
	return {repo, seeded};
}

describe('the seam pushes the work branch (RECOVERABLE half) through routeToNeedsAttention', () => {
	it('default push: the bounce pushes work/<slug> (with the wip + move) to the arbiter', async () => {
		const {repo, seeded} = await claimAndBranch('alpha');
		writeFileSync(join(repo, 'partial.txt'), 'agent work\n');

		const result = ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'alpha',
			reason: 'gate red',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// The work branch is on the arbiter at the local tip (the move-only commit),
		// carrying the wip below it — a requeue-continue can land on it.
		expect(arbiterHasBranch(seeded, 'work/alpha')).toBe(true);
		expect(arbiterRef(seeded, 'refs/heads/work/alpha')).toBe(
			gitIn(['rev-parse', 'HEAD'], repo).trim(),
		);
		expect(
			gitIn(['cat-file', '-e', `${ARBITER}/work/alpha:partial.txt`], repo),
		).toBe('');
		// And the surface still lands on main.
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(true);
	});

	it('non-default branch: a supplied `branch` is the push target (the slicing-branch shape)', async () => {
		// Stand up a slicing-style bounce: HEAD on work/slicing/<slug>, work in tree.
		const seeded = seedRepoWithArbiter(scratch.root, ['beta']);
		const repo = seeded.repo;
		const claim = await performClaim({
			slug: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		// The slicing lock uses a DIFFERENT branch name (auto-slice: work/slicing/…).
		gitIn(['switch', '-q', '-c', 'work/slicing/beta', `${ARBITER}/main`], repo);
		writeFileSync(join(repo, 'slice-output.md'), 'a produced slice\n');

		const result = ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'beta',
			reason: 'review rejected the produced slices',
			arbiter: ARBITER,
			branch: 'work/slicing/beta',
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// THAT branch was pushed (not the default work/beta) — the written slices
		// travel cross-machine so a requeue continues from them.
		expect(arbiterHasBranch(seeded, 'work/slicing/beta')).toBe(true);
		expect(arbiterHasBranch(seeded, 'work/beta')).toBe(false);
		expect(
			gitIn(
				['cat-file', '-e', `${ARBITER}/work/slicing/beta:slice-output.md`],
				repo,
			),
		).toBe('');
	});

	it('emptiness guard: a couldn’t-start bounce (no work beyond main) pushes NOTHING and does not error', async () => {
		// Claim + onboard, but the agent produced NOTHING (clean tree). The move-only
		// commit IS made, but we ask the seam to push a DIFFERENT, ABSENT branch to
		// exercise the guard's "branch absent / no work beyond main ⇒ skip" arm.
		const {repo, seeded} = await claimAndBranch('gamma');

		const result = ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'gamma',
			reason: 'could not even start',
			arbiter: ARBITER,
			// An absent branch ⇒ the emptiness guard skips the push (no error).
			branch: 'work/never-created',
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		// Nothing was pushed for the absent branch; the surface still landed.
		expect(arbiterHasBranch(seeded, 'work/never-created')).toBe(false);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'gamma')).toBe(true);
	});

	it('best-effort: an unreachable arbiter push does NOT throw the bounce', async () => {
		const {repo, seeded} = await claimAndBranch('delta');
		writeFileSync(join(repo, 'partial.txt'), 'work\n');
		// Reject work/* pushes on the arbiter (a pre-receive hook) so the branch push
		// FAILS — the bounce must still complete (best-effort), not throw.
		writeRejectWorkPushHook(seeded);

		expect(() =>
			ledgerWrite.applyNeedsAttentionTransition({
				cwd: repo,
				slug: 'delta',
				reason: 'gate red',
				arbiter: ARBITER,
				env: gitEnv(),
			}),
		).not.toThrow();
		// The push failed (rejected), so the branch is NOT on the arbiter — but the
		// move committed locally and (work/* only being rejected) the surface landed.
		expect(arbiterHasBranch(seeded, 'work/delta')).toBe(false);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'delta')).toBe(true);
	});

	it('SURFACE-ONLY (pushBranch:false): publishes the main surface, pushes NOTHING', async () => {
		const {repo, seeded} = await claimAndBranch('epsilon');
		writeFileSync(join(repo, 'partial.txt'), 'work\n');

		const result = ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'epsilon',
			reason: 'temp-branch caller',
			arbiter: ARBITER,
			pushBranch: false,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		// No branch push at all (surface-only), but the on-main surface still lands.
		expect(arbiterHasBranch(seeded, 'work/epsilon')).toBe(false);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'epsilon')).toBe(true);
	});

	it('human-vs-autonomous gate (no logic): NO arbiter ⇒ no surface AND no push (local-only)', async () => {
		const {repo, seeded} = await claimAndBranch('zeta');
		writeFileSync(join(repo, 'partial.txt'), 'work\n');

		const result = ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'zeta',
			// NB: no arbiter — the human `complete` path.
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		// Local-only: nothing pushed, main untouched (still shows in-progress).
		expect(arbiterHasBranch(seeded, 'work/zeta')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'zeta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'zeta')).toBe(false);
	});
});

const editingAgent: AgentRunner = ({cwd}) => {
	writeFileSync(join(cwd, 'partial.txt'), 'half-built\n');
	return {ok: false, detail: 'boom'};
};
const greenGate: TestGate = () => ({green: true});

function scanProject(config: Parameters<typeof scanRepoPaths>[1]) {
	return scanRepoPaths([join(scratch.root, 'project')], config);
}
function configFor(overrides = {}) {
	return mergeConfig({
		defaultArbiter: 'arbiter',
		maxParallel: 4,
		perRepoMax: 2,
		integration: 'merge',
		agentCmd: 'true',
		allowAgents: true,
		...overrides,
	});
}

describe('run agent-failure is SAVED + cross-machine recoverable (the fifth gap)', () => {
	it('a fresh clone requeue-continues onto the failed agent’s saved partial work', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const config = configFor();
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			testGate: greenGate,
			env: gitEnv(),
		});
		expect(result.items[0].status).toBe('agent-failed');
		// Saved + surfaced + pushed (the seam did all three).
		expect(arbiterHasBranch(seeded, 'work/alpha')).toBe(true);
		expect(existsOnArbiterMain(seeded.repo, 'needs-attention', 'alpha')).toBe(
			true,
		);

		// A human requeues (default keep + continue): needs-attention → backlog.
		const human = seeded.clone('requeuer');
		gitIn(['fetch', '-q', ARBITER], human);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], human);
		const requeued = returnToBacklog({
			cwd: human,
			slug: 'alpha',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(requeued.moved).toBe(true);

		// A DIFFERENT machine (a fresh clone) re-claims via start → CONTINUES from the
		// pushed branch, so the failed agent's partial work is present.
		const fresh = seeded.clone('continuer');
		const restarted = await performStart({
			slug: 'alpha',
			cwd: fresh,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(restarted.exitCode).toBe(0);
		expect(restarted.branch).toBe('work/alpha');
		expect(existsSync(join(fresh, 'partial.txt'))).toBe(true);
	});
});

describe('run §14 onboard continue-conflict now REAPS (its branch is already on the arbiter)', () => {
	it('routes to needs-attention; the work branch is on the arbiter (unchanged tip) ⇒ the worktree REAPS', async () => {
		// Build a kept work/<slug> whose rebase onto a moved main conflicts.
		const seeded = seedRepoWithArbiter(scratch.root, ['gamma']);
		const repo = seeded.repo;
		const claim = await performClaim({
			slug: 'gamma',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', 'work/gamma', `${ARBITER}/main`], repo);
		writeFileSync(join(repo, 'shared.txt'), 'branch version\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'prior edits shared'], repo);
		gitIn(['push', '-q', ARBITER, 'work/gamma:work/gamma'], repo);
		ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'gamma',
			reason: 'red',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		// The arbiter's work/gamma tip AFTER the prior bounce (the seam pushed the
		// move-only tip). The onboard continue-conflict aborts the rebase, leaving the
		// worktree on THIS tip — it must stay unchanged on the arbiter.
		const keptTip = arbiterRef(seeded, 'refs/heads/work/gamma');
		expect(keptTip).not.toBe('');
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
		returnToBacklog({
			cwd: repo,
			slug: 'gamma',
			arbiter: ARBITER,
			env: gitEnv(),
		});

		// main edits the same file differently (conflict on replay at onboard-time).
		const mover = seeded.clone('mover');
		gitIn(['fetch', '-q', ARBITER], mover);
		gitIn(['switch', '-q', '-C', 'mv-main', `${ARBITER}/main`], mover);
		writeFileSync(join(mover, 'shared.txt'), 'main version\n');
		gitIn(['add', '-A'], mover);
		gitIn(['commit', '-q', '-m', 'main edits shared too'], mover);
		gitIn(['push', '-q', ARBITER, 'mv-main:main'], mover);

		// `run` over the registry-style report: the job onboards, hits the continue
		// rebase-conflict, routes to needs-attention through the seam.
		// The agent never runs (the onboard continue-conflict returns before step 3);
		// inject an agent that would FAIL the test if reached, to prove that.
		const config = configFor();
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: () => {
				throw new Error('agent must NOT run on an onboard continue-conflict');
			},
			testGate: greenGate,
			env: gitEnv(),
		});
		expect(result.items[0].status).toBe('needs-attention');
		// The kept branch is on the arbiter at its UNCHANGED tip (the aborted rebase
		// left the tip == the kept tip == the arbiter tip) — the durable artifact, not
		// the worktree. (The seam's default-push here is a no-op/ff at most.)
		expect(arbiterHasBranch(seeded, 'work/gamma')).toBe(true);
		expect(arbiterRef(seeded, 'refs/heads/work/gamma')).toBe(keptTip);
		// Because the branch is provably on the arbiter, the §4 reap predicate HOLDS
		// ⇒ the worktree is REAPED (the §14-aligned outcome: the worktree is a
		// disposable cache; recovery flows through the branch + surface). No special
		// retention to preserve.
		const dir = jobWorktreePath(
			join(scratch.root, 'ws'),
			`file://${seeded.arbiter}`,
			'gamma',
		);
		expect(existsSync(dir)).toBe(false);
	});
});

/**
 * Install a `pre-receive` hook on the bare arbiter that rejects any
 * `refs/heads/work/` push (the `main` surface push is still accepted) — used to
 * make the seam's best-effort branch push fail without taking the whole arbiter
 * offline (which would also break the surface publish).
 */
function writeRejectWorkPushHook(seeded: SeededRepo): void {
	const hook = join(seeded.arbiter, 'hooks', 'pre-receive');
	writeFileSync(
		hook,
		[
			'#!/usr/bin/env bash',
			'while read -r _o _n ref; do',
			'  case "$ref" in refs/heads/work/*) exit 1;; esac',
			'done',
			'exit 0',
			'',
		].join('\n'),
	);
	chmodSync(hook, 0o755);
}
