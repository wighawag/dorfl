import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {performIntegration} from '../src/integration-core.js';
import {performClaim} from '../src/claim-cas.js';
import type {ReviewGate, ReviewVerdict} from '../src/review-gate.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
	rmrf,
} from './helpers/gitRepo.js';

/**
 * Task `committed-recovery-honours-fresh-worktree-gate` (prd
 * `land-time-reverify-and-parallel-merge-ceiling`, covers stories 15+16).
 *
 * `recoverAlreadyCommitted` is the committed-recovery TAIL of
 * `performIntegration` (`committedRecovery: true`): the work branch already
 * carries its `…; done` commit, so the build path's `git mv` + `git add -A` +
 * commit would raise `IntegrationNothingStaged`. The ORIGINAL caller — a
 * stranded already-built branch the prior attempt gated before pushing — is
 * fine without a re-gate. But the answered-merge land (the apply-rung of
 * surfaced merge-questions) reuses this EXACT tail, and there `<arbiter>/main`
 * may have MOVED since the branch's last build, so the rebased tip MUST be
 * re-verified before it lands or the load-bearing invariant ("main never
 * receives a tree that fails verify") cannot hold on the merge path.
 *
 * These tests assert the EXTERNAL behaviour of that contract:
 *  - with `freshWorktreeGate: true` + a moved-main that breaks verify on the
 *    rebased tip → the gate REFUSES (routed to needs-attention), `main` never
 *    receives the failing tree;
 *  - with `freshWorktreeGate: true` + a clean rebased tip → the gate passes
 *    and the kept commit lands;
 *  - WITHOUT `freshWorktreeGate` (the stranded-recovery caller) → byte-
 *    identical to today: no gate runs, even a tree that WOULD fail verify on
 *    the rebased tip still lands (the prior build already gated).
 *
 * House style mirrors `finish-already-committed.test.ts` /
 * `recovery-rebase-retry-against-moving-arbiter-main.test.ts`: a throwaway
 * checkout + a local `--bare` arbiter, `gitEnv()` isolation, nothing global
 * touched.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-committed-recovery-fwg-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/** A stubbed review gate returning a fixed verdict (no real model). */
function stubGate(verdict: ReviewVerdict): ReviewGate {
	return async () => verdict;
}
const APPROVE: ReviewVerdict = {
	verdict: 'approve',
	findings: [{severity: 'non-blocking', question: 'a nit to capture'}],
	review: 'Approved. The recovered kept commit reaches the task goal.',
};
const BLOCK: ReviewVerdict = {
	verdict: 'block',
	findings: [
		{severity: 'blocking', question: 'the diff does not reach the task goal'},
	],
};
/** A verify that passes on the rebased tip (the kept commit's canary content). */
const PASS_VERIFY = 'test "$(cat feature.txt)" = "the work"';

/**
 * Stand a repo up exactly as the answered-merge apply-rung will hand it to
 * `recoverAlreadyCommitted`: claimed, branched off the seeded main, the agent's
 * work committed, the `git mv` `ready/ → done/` committed (`…; done`), but the
 * tip NOT pushed (the answered-merge caller has not integrated yet). The kept
 * commit modifies `feature.txt` (untouched on main → no rebase conflict; the
 * rebase is clean).
 */
async function seedCommittedRecovery(
	slug: string,
): Promise<{repo: string; seeded: SeededRepo; tip: string}> {
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

	// The agent's work, committed. `feature.txt` is the canary the verify
	// commands inspect (a content the kept commit puts on the rebased tip).
	writeFileSync(join(repo, 'feature.txt'), 'the work\n');
	mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
	gitIn(
		['mv', `work/tasks/ready/${slug}.md`, `work/tasks/done/${slug}.md`],
		repo,
	);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `feat(${slug}): build the thing; done`], repo);

	const tip = gitIn(['rev-parse', 'HEAD'], repo).trim();
	return {repo, seeded, tip};
}

/**
 * Land a sibling commit on `<arbiter>/main` (via a throwaway clone) that
 * writes a non-conflicting file. The kept commit does not touch this path, so
 * the rebase stays CLEAN — the file simply appears in the rebased tip. Used to
 * simulate "main moved between the branch's last build and the answered-merge
 * apply" without forcing a rebase conflict (the conflict path has its own
 * tests; this task is about the gate AFTER a clean rebase).
 */
function advanceMainWithFile(
	seeded: SeededRepo,
	label: string,
	relPath: string,
	content: string,
): void {
	const dest = join(scratch.root, `arbiter-advance-${label}`);
	gitIn(['clone', '-q', `file://${seeded.arbiter}`, dest], scratch.root);
	gitIn(['checkout', '-q', 'main'], dest);
	const abs = join(dest, relPath);
	mkdirSync(join(abs, '..'), {recursive: true});
	writeFileSync(abs, content);
	gitIn(['add', '-A'], dest);
	gitIn(['commit', '-q', '-m', `arbiter advance ${label}`], dest);
	gitIn(['push', '-q', 'origin', 'main:main'], dest);
	rmrf(dest);
}

describe('recoverAlreadyCommitted — `freshWorktreeGate` re-verifies the REBASED tip before landing', () => {
	it('RED gate on the rebased tip (moved-main + breaks verify) → REFUSES to integrate; routes to needs-attention; `<arbiter>/main` never receives the failing tree', async () => {
		const {repo, seeded, tip} = await seedCommittedRecovery('alpha');

		// Main moved between the branch's last build and this answered-merge apply:
		// a sibling commit added `must-not-exist.txt`. The rebase is CLEAN (the kept
		// commit does not touch that file), but `verify` on the rebased tip will
		// fail BECAUSE that file is now present.
		advanceMainWithFile(seeded, 'broke', 'must-not-exist.txt', 'oops\n');

		const result = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'alpha',
			source: 'tasks-ready',
			recovering: false,
			committedRecovery: true,
			mode: 'merge',
			freshWorktreeGate: true,
			// The acceptance gate FAILS when `must-not-exist.txt` is present in the
			// gate worktree (the rebased tip). A pre-rebase gate run in `cwd` would
			// PASS (the file is not in `cwd` yet) — proving the gate ran on the
			// REBASED tip, not the agent's pre-rebase checkout.
			verify: '! test -f must-not-exist.txt',
			env: gitEnv(),
		});

		// External behaviour:
		expect(result.outcome).toBe('gate-failed');
		expect(result.routedToNeedsAttention).toBe(true);
		// `<arbiter>/main` DID NOT advance to the kept commit — the FAILING tree
		// never landed. (`applyNeedsAttentionTransition` may surface a separate
		// bounce commit on main, but the kept tip itself MUST NOT be reachable.)
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
		gitIn(['fetch', '-q', ARBITER], repo);
		const arbiterMainAfter = gitIn(
			['rev-parse', `${ARBITER}/main`],
			repo,
		).trim();
		expect(arbiterMainAfter).not.toBe(tip);
		// The kept commit is NOT reachable on `<arbiter>/main` (the work that
		// would have failed verify is not on main). `merge-base --is-ancestor`
		// exit 0 ⇒ reachable; exit 1 ⇒ not. Use a soft `spawnSync` since `gitIn`
		// throws on non-zero.
		const isAncestor = spawnSync(
			'git',
			['merge-base', '--is-ancestor', tip, `${ARBITER}/main`],
			{cwd: repo, env: gitEnv()},
		);
		expect(isAncestor.status).not.toBe(0);
	});

	it('GREEN gate on the rebased tip (moved-main but verify still passes) → INTEGRATES exactly as today: the kept commit lands on `<arbiter>/main`', async () => {
		const {repo, seeded, tip} = await seedCommittedRecovery('beta');

		// Main moved with a NON-conflicting, NON-breaking file: the rebase is
		// clean AND the verify on the rebased tip passes.
		advanceMainWithFile(seeded, 'benign', 'sibling.txt', 'benign sibling\n');

		const result = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'beta',
			source: 'tasks-ready',
			recovering: false,
			committedRecovery: true,
			mode: 'merge',
			freshWorktreeGate: true,
			// Verify passes when the kept commit's `feature.txt` is on the rebased
			// tip — proving the gate ran AGAINST the rebased tip (the kept commit
			// added that content).
			verify: 'test "$(cat feature.txt)" = "the work"',
			env: gitEnv(),
		});

		expect(result.outcome).toBe('completed');
		// The kept commit's work landed on `<arbiter>/main`.
		expect(existsOnArbiterMain(repo, 'done', 'beta')).toBe(true);
		expect(gitIn(['show', `${ARBITER}/main:feature.txt`], repo).trim()).toBe(
			'the work',
		);
		// The sibling's move was preserved (the rebase composed cleanly with it).
		expect(gitIn(['show', `${ARBITER}/main:sibling.txt`], repo).trim()).toBe(
			'benign sibling',
		);
		// And the rebased landing is NOT the original kept tip (main moved, so the
		// rebase produced a new commit sha for the integrated tip).
		expect(gitIn(['rev-parse', `${ARBITER}/main`], repo).trim()).not.toBe(tip);
	});

	it('REGRESSION: WITHOUT `freshWorktreeGate` (the stranded-recovery caller) the gate is NOT run — even a tree that WOULD fail verify on the rebased tip still lands, byte-identical to today', async () => {
		const {repo, seeded, tip} = await seedCommittedRecovery('gamma');

		// Same shape as the RED-gate test (moved main introduces a file the gate
		// would refuse): if the gate ran, this would route to needs-attention. With
		// `freshWorktreeGate` unset (the stranded-recovery caller, whose pre-strand
		// build already gated), the gate MUST NOT run and the kept commit lands.
		advanceMainWithFile(seeded, 'broke', 'must-not-exist.txt', 'oops\n');

		const result = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'gamma',
			source: 'tasks-ready',
			recovering: false,
			committedRecovery: true,
			mode: 'merge',
			// freshWorktreeGate intentionally OMITTED.
			// A verify that WOULD fail if the gate ran. Passing this proves the
			// gate did NOT run.
			verify: '! test -f must-not-exist.txt',
			env: gitEnv(),
		});

		expect(result.outcome).toBe('completed');
		// The kept commit's work landed on `<arbiter>/main` — no extra gate
		// blocked it, no extra fetch reshaped routing.
		expect(existsOnArbiterMain(repo, 'done', 'gamma')).toBe(true);
		expect(gitIn(['show', `${ARBITER}/main:feature.txt`], repo).trim()).toBe(
			'the work',
		);
		// The integrated tip is NOT the original (main moved → rebase produced a
		// new sha), but the WORK from the kept commit landed.
		expect(gitIn(['rev-parse', `${ARBITER}/main`], repo).trim()).not.toBe(tip);
	});
});

/**
 * Task `committed-recovery-always-reviews` (this fix): a stranded already-
 * complete branch is NOT trusted as already-reviewed — its earlier attempt's PR
 * never merged, and Gate 2 may never have run on it. So when `review` is on, the
 * committed-recovery tail MUST run Gate 2 on the rebased tip (the SAME reasoning
 * that forces the re-verify: `<arbiter>/main` moved, the merged tree is new). A
 * BLOCK routes to needs-attention and NEVER integrates; an APPROVE integrates and
 * folds the per-run nits observation into the kept commit.
 */
describe('recoverAlreadyCommitted — Gate 2 review runs on the rebased tip (never trusts "already reviewed")', () => {
	it('review on + BLOCK ⇒ routes to needs-attention; `<arbiter>/main` never receives the kept commit', async () => {
		const {repo, tip} = await seedCommittedRecovery('delta');

		const result = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'delta',
			source: 'tasks-ready',
			recovering: false,
			committedRecovery: true,
			mode: 'merge',
			freshWorktreeGate: true,
			verify: PASS_VERIFY,
			review: true,
			reviewGate: stubGate(BLOCK),
			env: gitEnv(),
		});

		expect(result.outcome).toBe('review-blocked');
		expect(result.routedToNeedsAttention).toBe(true);
		// The kept commit did NOT land — a blocked review never integrates.
		expect(existsOnArbiterMain(repo, 'done', 'delta')).toBe(false);
		gitIn(['fetch', '-q', ARBITER], repo);
		const isAncestor = spawnSync(
			'git',
			['merge-base', '--is-ancestor', tip, `${ARBITER}/main`],
			{cwd: repo, env: gitEnv()},
		);
		expect(isAncestor.status).not.toBe(0);
	});

	it('review on + APPROVE ⇒ integrates the kept commit AND folds the per-run nits observation into it', async () => {
		const {repo} = await seedCommittedRecovery('epsilon');

		const result = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'epsilon',
			source: 'tasks-ready',
			recovering: false,
			committedRecovery: true,
			mode: 'merge',
			freshWorktreeGate: true,
			verify: PASS_VERIFY,
			review: true,
			reviewGate: stubGate(APPROVE),
			env: gitEnv(),
		});

		expect(result.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'epsilon')).toBe(true);
		// The approve carried a non-blocking finding ⇒ a per-run `review-nits-*`
		// observation was written and FOLDED into the kept commit that integrated
		// (it reaches `<arbiter>/main`, not a separate commit).
		gitIn(['fetch', '-q', ARBITER], repo);
		const obs = gitIn(
			[
				'ls-tree',
				'-r',
				'--name-only',
				`${ARBITER}/main`,
				'work/notes/observations/',
			],
			repo,
		);
		expect(obs).toMatch(/review-nits-epsilon-/);
	});

	it('review on with NO reviewGate wired ⇒ the recovery tail throws the config-error (the floor is never silently skipped)', async () => {
		const {repo} = await seedCommittedRecovery('zeta');

		// `review: true` but no gate wired is a wiring bug the core must NOT swallow
		// into a silent skip — it throws, exactly like the build path.
		await expect(
			performIntegration({
				cwd: repo,
				arbiter: ARBITER,
				slug: 'zeta',
				source: 'tasks-ready',
				recovering: false,
				committedRecovery: true,
				mode: 'merge',
				freshWorktreeGate: true,
				verify: PASS_VERIFY,
				review: true,
				// reviewGate intentionally OMITTED.
				env: gitEnv(),
			}),
		).rejects.toThrow(/review is on but no review gate is configured/);
		// Nothing landed — the throw happened before integrate.
		expect(existsOnArbiterMain(repo, 'done', 'zeta')).toBe(false);
	});
});
