import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {existsSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {readItemLock} from '../src/item-lock.js';
import {performComplete} from '../src/complete.js';
import {performClaim} from '../src/claim-cas.js';
import * as ledgerWriteModule from '../src/ledger-write.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * Slice `autonomous-integration-refusal-surfaces-not-strands-in-progress` (PRD
 * `ledger-integrity` story 7): the AUTONOMOUS integration path's source-strand
 * refusal must SURFACE the slug to `work/needs-attention/` on the arbiter —
 * never silently strand it in `work/in-progress/`. The HUMAN in-place refusal
 * (no `surfaceArbiter`) and the diverged-main env condition stay UNCHANGED.
 *
 * Pinned set of refusals the autonomous bounce covers:
 *   (a) the source-strand `CompleteRefusal` (`nothing to complete (already done,
 *       or wrong slug?)` — the strand the CI incident produced) ⇒ BOUNCE.
 *   (b) the core's `IntegrationNothingStaged` (empty-commit refusal under a
 *       re-claim of a green branch with no source to move) ⇒ BOUNCE (the pinned
 *       autonomous decision: a no-progress strand is itself stuck).
 *   (c) the diverged-main `CompleteRefusal` ⇒ NOT bounced (env/operator
 *       condition, not a stuck slice).
 *
 * The surface uses the TREE-LESS seam
 * (`ledgerWrite.applyTreelessNeedsAttentionTransition`) the
 * `requeue`/`continue` paths already use in reverse: arbiter-truth + idempotent,
 * and returns `{moved:false}` honestly when it cannot land (CAS contention / no
 * arbiter). On `moved:false` the result is the HONEST `surface-unmoved` outcome
 * (the item is still in-progress on the arbiter), never a fake success.
 *
 * House style: throwaway `--bare` `file://` arbiters + real clones (mirrors
 * `autonomous-recovers-stranded-done.test.ts`); no shared/global location.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-autonomous-strand-surface-');
});
afterEach(() => {
	scratch.cleanup();
	vi.restoreAllMocks();
});

const ARBITER = 'arbiter';

/**
 * Stand the CI repro: claim the slug (the body RESTS in `work/tasks/todo/<slug>.md`
 * on the arbiter, since claim no longer moves it), put HEAD on the work branch,
 * and remove the slice body from the BRANCH tree WITHOUT done-moving it — the
 * source-strand state the autonomous source-resolution refuses with "nothing to
 * complete". The arbiter still holds the body in `work/tasks/todo/`.
 */
async function seedSourceStrand(slug: string): Promise<string> {
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
	gitIn(['switch', '-q', '-c', `work/slice-${slug}`, `${ARBITER}/main`], repo);
	gitIn(['rm', '-q', `work/tasks/todo/${slug}.md`], repo);
	gitIn(['commit', '-q', '-m', 'drop the slice (genuinely nothing)'], repo);
	expect(existsSync(join(repo, 'work', 'tasks', 'todo', `${slug}.md`))).toBe(
		false,
	);
	expect(existsSync(join(repo, 'work', 'tasks', 'done', `${slug}.md`))).toBe(
		false,
	);
	expect(existsSync(join(repo, 'work', 'needs-attention', `${slug}.md`))).toBe(
		false,
	);
	// The arbiter still holds the body in backlog/ (claim wrote nothing to main).
	expect(existsOnArbiterMain(repo, 'backlog', slug)).toBe(true);
	return repo;
}

describe('autonomous integrate path — source-strand refusal SURFACES, never strands in-progress/', () => {
	it('AUTONOMOUS source-strand: arbiter shows needs-attention/, NOT in-progress/ — the next tick does not re-claim and re-crash', async () => {
		const repo = await seedSourceStrand('alpha');
		const notes: string[] = [];

		const result = await performComplete({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			// The autonomous gate (what `do.ts` passes as `tree.arbiterRemote`).
			surfaceArbiter: ARBITER,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('strand-surfaced');
		expect(result.routedToNeedsAttention).toBe(true);
		// The stuck state is the per-item lock (the body rests in backlog/), so
		// `scan`/`status`/another machine see it as stuck (not a live claim) and the
		// next autonomous tick does not re-claim it.
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		// The reason is recorded on the lock entry (the refusal message).
		const lock = await readItemLock({
			item: 'slice:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock?.reason).toMatch(/nothing to complete/i);
		// LOUD: a surface note fired (distinct from a normal completion message),
		// so the CI/job log records the autonomous bounce.
		expect(notes.some((n) => /surfaced.*needs-attention/i.test(n))).toBe(true);
	});

	it('HUMAN refusal (no surfaceArbiter) is UNCHANGED: bare `refused`, checkout NOT bounced, arbiter unchanged', async () => {
		const repo = await seedSourceStrand('beta');

		const result = await performComplete({
			slug: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			// surfaceArbiter UNSET — the human-vs-autonomous gate.
			env: gitEnv(),
			note: () => {},
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		expect(result.message).toMatch(/nothing to complete/i);
		// The arbiter is UNCHANGED: the body still rests in backlog/ (the human is
		// right there and resolves the strand themselves — no cross-machine surfacing).
		expect(existsOnArbiterMain(repo, 'backlog', 'beta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'beta')).toBe(false);
		// The checkout was NOT bounced (HEAD still on the work branch).
		const head = gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim();
		expect(head).toBe('work/slice-beta');
	});

	it('DIVERGED-MAIN refusal is NEVER bounced (env/operator condition, not a stuck slice) — even on the autonomous path', async () => {
		// Seed + claim. Then put HEAD on the work branch, leave the in-progress slice
		// IN PLACE (the diverged-main throw fires BEFORE source-resolution would
		// refuse). Diverge local main: add an unpushed commit to main.
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
		gitIn(['switch', '-q', 'main'], repo);
		writeFileSync(join(repo, 'unpushed.txt'), 'unpushed\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'unpushed local commit'], repo);
		// Switch onto the work branch (HEAD is reset to the arbiter base for the
		// work — diverged-main is purely a local-main vs arbiter/main condition).
		gitIn(['switch', '-q', '-c', 'work/slice-gamma', `${ARBITER}/main`], repo);
		// Stage the agent's work (so the build path would be reachable past gate).
		writeFileSync(join(repo, 'feature.txt'), 'work\n');
		// Run with surfaceArbiter set AND `--merge` (the only mode that runs the
		// diverged-main guard) AND ignoreDivergedMain unset.
		const result = await performComplete({
			slug: 'gamma',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			surfaceArbiter: ARBITER,
			env: gitEnv(),
			note: () => {},
		});

		expect(result.exitCode).toBe(1);
		// The diverged-main refusal stays a bare `refused`, NOT bounced — even
		// though `surfaceArbiter` is set (autonomous path).
		expect(result.outcome).toBe('refused');
		expect(result.message).toMatch(/local main is ahead/i);
		// The arbiter is UNCHANGED: the body still rests in backlog/ (no surface fired).
		expect(existsOnArbiterMain(repo, 'backlog', 'gamma')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'gamma')).toBe(false);
	});

	it('IntegrationNothingStaged on the AUTONOMOUS path BOUNCES to needs-attention (pinned decision: a no-progress empty integrate is itself a strand)', async () => {
		// Set up the rare path where the integration core throws
		// `IntegrationNothingStaged` (`nothing to commit ... no work and no move
		// staged`): claim the slug, put HEAD on the work branch, leave the
		// in-progress slice file in place, but DO NOT done-move it locally — and
		// arrange that the core's done-move is suppressed too. The simplest way:
		// pre-move the slice into work/tasks/done/ on the branch tree AND commit it (so
		// the core's `git mv` from in-progress/ to done/ has nothing to stage) AND
		// keep the agent's tree clean (no uncommitted work). To force the throw we
		// land the same state on the work branch HEAD with nothing further to
		// commit:
		const seeded = seedRepoWithArbiter(scratch.root, ['delta']);
		const repo = seeded.repo;
		const claim = await performClaim({
			slug: 'delta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', 'work/slice-delta', `${ARBITER}/main`], repo);
		// Do the done-move locally AND commit it (so the source-strand auto-recover
		// would otherwise fire — we need an explicit IntegrationNothingStaged path).
		// Re-create in-progress/ alongside (no source-strand) so the front-gate
		// resolves source='in-progress' and the core's done-move from in-progress/
		// to done/ runs — but the destination already has the file so the staged
		// diff is empty.
		mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
		// Make a second copy of the slice in done/ committed already.
		writeFileSync(
			join(repo, 'work', 'tasks', 'done', 'delta.md'),
			'pre-done\n',
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'pre-seed done/delta.md'], repo);

		// `IntegrationNothingStaged` is hard to reach deterministically from the
		// outside (the core's done-move + add -A normally stage something). Stub
		// the seam-callable surface helper directly: prove that the OUTCOME mapping
		// for the empty-staged class lands on `strand-surfaced` via the seam.
		// (The bounce-set membership of IntegrationNothingStaged is enforced in
		// `complete.ts`'s `strandRefusalSlug` and unit-pinned by the surface call
		// arriving with the slug.) Inject the throw at the core boundary so the
		// outer catch's strand-dispatch is exercised end-to-end.
		const {IntegrationNothingStaged} =
			await import('../src/integration-core.js');
		const integrationCore = await import('../src/integration-core.js');
		vi.spyOn(integrationCore, 'performIntegration').mockImplementation(
			async () => {
				throw new IntegrationNothingStaged(
					"nothing to commit for 'delta' — no work and no move staged.",
					'delta',
				);
			},
		);

		// Reset to a clean source-present state so the front-gate does NOT take the
		// stranded-done route (it would skip the core).
		gitIn(['rm', '-q', '--cached', 'work/tasks/done/delta.md'], repo);
		gitIn(['commit', '-q', '-m', 'unstash done/delta.md'], repo);

		const notes: string[] = [];
		const result = await performComplete({
			slug: 'delta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			surfaceArbiter: ARBITER,
			ignoreDivergedMain: true,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('strand-surfaced');
		expect(result.routedToNeedsAttention).toBe(true);
		// The stuck state is the per-item lock; the body rests in backlog/.
		expect(stuckLockOnArbiter(repo, 'delta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'backlog', 'delta')).toBe(true);
	});

	it('SURFACE CANNOT LAND ⇒ HONEST still-in-progress signal (`surface-unmoved`), never a fake success', async () => {
		const repo = await seedSourceStrand('epsilon');

		// Stub the tree-less seam to return {moved:false} (the CAS-contention-
		// exhausted / no-arbiter path the seam reports honestly). The result must
		// be `surface-unmoved`, NOT a fake `strand-surfaced`.
		vi.spyOn(
			ledgerWriteModule.ledgerWrite,
			'applyTreelessNeedsAttentionTransition',
		).mockResolvedValue({
			moved: false,
			reasonNotMoved: 'CAS contention exhausted (stubbed).',
		});

		const result = await performComplete({
			slug: 'epsilon',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			surfaceArbiter: ARBITER,
			env: gitEnv(),
			note: () => {},
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('surface-unmoved');
		expect(result.routedToNeedsAttention).toBe(false);
		expect(result.message).toMatch(/still IN-PROGRESS/i);
		expect(result.message).toMatch(/CAS contention exhausted/i);
	});
});
