import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performComplete} from '../src/complete.js';
import {performClaim} from '../src/claim-cas.js';
import {type ReviewProvider} from '../src/integrator.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * Follow-up task
 * `complete-propose-honour-already-landed-and-rename-continue-branch-module`:
 * when the integrator's propose push returns `alreadyLanded: true` (the benign
 * already-landed race tail added by `propose-push-survives-stale-lease-on-
 * reaped-work-ref`), `complete.ts` must SURFACE the integrator's `instruction`
 * text and NOT emit the generic "Pushed <branch> to <arbiter> ... Open a PR/MR"
 * next-step block — nothing was pushed here and there is no ref for a PR to
 * point at.
 *
 * Scenario (mirrors the kappa case in `stale-lease-propose-push.test.ts`, but
 * driven at `performComplete` so the `complete.ts` caller's next-step branch is
 * exercised):
 *
 *   (1) claim + build + commit + `git mv ready→done` locally (the stranded-
 *       done shape `performComplete` auto-detects as `committedRecovery`);
 *   (2) a SIBLING clone lands the same-content diff on `<arbiter>/main` with
 *       a DIFFERENT sha (parallel commit), reaping any `work/<slug>` ref by
 *       never creating one;
 *   (3) `performComplete(--propose)` runs the recovery rebase; the propose
 *       push observes gone-ref + HEAD-on-main → `alreadyLanded: true` with the
 *       integrator's `instruction`.
 *
 * Assertion: the emitted notes carry the integrator's already-landed
 * `instruction` prose and DO NOT carry the generic push+PR next-step text.
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-complete-already-landed-');
});
afterEach(() => {
	scratch.cleanup();
});

/** A provider whose `openRequest` explodes — the alreadyLanded path must never call it. */
function explodingProvider(): ReviewProvider {
	return {
		name: 'explodes',
		async openRequest() {
			throw new Error(
				'openRequest must not be called when propose is already-landed',
			);
		},
		postPRComment() {
			return {posted: false, instruction: ''};
		},
		postPRCommentOnBranch() {
			return {posted: false, instruction: ''};
		},
	};
}

describe('complete --propose — honours integrator.alreadyLanded (no false push+PR next step)', () => {
	it('emits the integrator\'s alreadyLanded `instruction` verbatim and NOT the generic "Pushed ... Open a PR/MR" next step', async () => {
		const slug = 'kappa';
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

		// (1) Stand up the stranded-done shape: build + done-move + commit on the
		// work branch. `work/tasks/done/<slug>.md` locally = the shape `complete`
		// front-gates on to route through the committedRecovery path.
		const branch = `work/task-${slug}`;
		gitIn(['switch', '-q', '-c', branch, `${ARBITER}/main`], repo);
		writeFileSync(join(repo, `${slug}.txt`), `${slug}-work\n`);
		mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
		gitIn(
			['mv', `work/tasks/ready/${slug}.md`, `work/tasks/done/${slug}.md`],
			repo,
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', `feat(${slug}): build; done`], repo);

		// (2) Sibling clone lands the SAME diff on <arbiter>/main with a
		// DIFFERENT sha. The early-ancestor check on the kept tip therefore
		// fails; the recovery rebase later replays into an empty diff → HEAD
		// ends up at <arbiter>/main.
		const sibling = seeded.clone(`sibling-${slug}`);
		gitIn(['switch', '-q', '-C', 'sib', `${ARBITER}/main`], sibling);
		writeFileSync(join(sibling, `${slug}.txt`), `${slug}-work\n`);
		mkdirSync(join(sibling, 'work', 'tasks', 'done'), {recursive: true});
		gitIn(
			['mv', `work/tasks/ready/${slug}.md`, `work/tasks/done/${slug}.md`],
			sibling,
		);
		gitIn(['add', '-A'], sibling);
		gitIn(
			['commit', '-q', '-m', `feat(${slug}): sibling-merged equivalent`],
			sibling,
		);
		gitIn(['push', '-q', ARBITER, 'sib:main'], sibling);

		// (3) Drive complete --propose. The propose push sees gone-ref + HEAD-
		// on-main → alreadyLanded. We capture BOTH `note` (the summary) and
		// `noteBlock` (the visually-distinct next-step block) — the block must
		// STAY EMPTY on this path (we never render formatProposeNextStep) and
		// the summary must carry the integrator's alreadyLanded instruction.
		const notes: string[] = [];
		const blocks: string[] = [];
		const result = await performComplete({
			slug,
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			providerInstance: explodingProvider(),
			verify: 'exit 0',
			note: (m) => notes.push(m),
			noteBlock: (m) => blocks.push(m),
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(result.mergedToMain).toBe(false);

		const allNotes = notes.join('\n');
		const allBlocks = blocks.join('\n');
		// The summary carries the integrator's clean-no-op prose (`already on
		// <arbiter>/main`), NOT the generic push+PR next step.
		expect(allNotes).toMatch(/already on arbiter\/main/i);
		expect(allNotes).not.toMatch(/Open a PR\/MR/);
		expect(allNotes).not.toMatch(/opened a review/);
		// The visually-distinct next-step block is SUPPRESSED on the already-
		// landed path — nothing was pushed, there is nothing to act on.
		expect(allBlocks).not.toMatch(/Open a PR\/MR/);
		expect(allBlocks).not.toMatch(/Pushed .* to arbiter/);
		// End-state: the work landed on main via the sibling; the ref stays
		// absent on the arbiter (the reaped-head + landed-content shape).
		expect(existsOnArbiterMain(repo, 'done', slug)).toBe(true);
	});
});
