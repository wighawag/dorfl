import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performDo, type DoAgentRunner} from '../src/do.js';
import {performClaim} from '../src/claim-cas.js';
import {performIntake, type IntakeVerdict} from '../src/intake.js';
import {inPlaceStrategy} from '../src/isolation.js';
import {workBranchRef} from '../src/slug-namespace.js';
import type {IssueProvider} from '../src/issue-provider.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * REGRESSION tests for the structural bug: the work BRANCH ref was `work/<slug>`,
 * un-namespaced, so `intake`, `do slice:<slug>`, and `do prd:<slug>` all collided
 * on the SAME branch for the same slug (observations
 * `work-branch-name-not-namespaced-prd-vs-slice-collision.md` +
 * `do-onboarding-reuses-stale-work-branch-instead-of-claim-commit.md`). These
 * prove the firing collision is gone and the four branch identities are distinct.
 *
 * House style: a throwaway checkout + a local `--bare` arbiter + STUBBED agent /
 * decider seams; real git, writes `main`, so non-parallel.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-branch-ns-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';
const PASS = 'exit 0';

/** A stubbed build agent: edits a file so the commit is non-empty, succeeds. */
const editingAgent: DoAgentRunner = ({cwd}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
	return {ok: true};
};

describe('branch namespace — a same-slug slice and PRD never collide', () => {
	it('claim, onboard, and gc all agree on the namespaced ref (slice ≠ prd)', async () => {
		// A slug that exists as BOTH a backlog slice AND a PRD (the collision case
		// advance-loop made first-class). Distinct branch refs by construction.
		const taskRef = workBranchRef('task', 'dup');
		const briefRef = workBranchRef('brief', 'dup');
		const intakeTaskRef = workBranchRef('task', 'dup', {producer: 'intake'});
		expect(new Set([taskRef, briefRef, intakeTaskRef]).size).toBe(3);

		// Claim the slice + onboard in-place: the branch is the SLICE ref, carrying
		// the claim, never the PRD ref.
		const {repo} = seedRepoWithArbiter(scratch.root, ['dup'], {
			briefs: ['dup'],
		});
		const claim = await performClaim({
			slug: 'dup',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.outcome).toBe('claimed');

		const tree = inPlaceStrategy({checkout: repo, arbiter: ARBITER}).prepare({
			slug: 'dup',
			type: 'task',
			claimCommit: claim.claimCommit,
			env: gitEnv(),
		});
		expect(tree.branch).toBe(taskRef);
		expect(tree.branch).not.toBe(briefRef);
		expect(gitIn(['symbolic-ref', '--short', 'HEAD'], repo).trim()).toBe(
			taskRef,
		);
		// The PRD branch ref was never created by the slice onboard.
		expect(gitIn(['branch', '--list', briefRef], repo).trim()).toBe('');
	});
});

describe('intake then do slice:<slug> on the same slug + checkout — no collision', () => {
	it('intake leaves work/intake-task-<slug>; the later build lands on work/task-<slug> and COMPLETES (no "nothing to complete")', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const slug = 'add-quiet-flag';

		// 1. A real intake (merge) that creates the backlog slice. Its onboarding
		//    branch is the INTAKE-produced `work/intake-task-<slug>`.
		const verdict: IntakeVerdict = {
			outcome: 'task',
			taskSlug: slug,
			taskTitle: 'Add a --quiet flag',
			taskBody: [
				'## What to build',
				'',
				'A --quiet flag.',
				'',
				'## Acceptance criteria',
				'',
				'- [ ] works',
				'',
				'## Prompt',
				'',
				'> Add a --quiet flag.',
			].join('\n'),
		};
		const intake = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: minimalIssueProvider(),
			decide: async () => verdict,
			reviewSlice: async () => ({verdict: 'approve', findings: []}),
			integration: {task: 'merge', brief: 'merge'},
			env: gitEnv(),
		});
		expect(intake.exitCode).toBe(0);
		expect(intake.outcome).toBe('tasked');
		// The slice is on the arbiter's backlog (merge landed it).
		expect(existsOnArbiterMain(repo, 'backlog', slug)).toBe(true);

		// The intake branch is the INTAKE-namespaced ref — distinct from the build
		// ref. Simulate it being LEFT BEHIND locally (the firing precursor): the
		// checkout still has a local `work/intake-task-<slug>` from the intake run.
		const intakeRef = workBranchRef('task', slug, {producer: 'intake'});
		const buildRef = workBranchRef('task', slug);
		expect(intakeRef).not.toBe(buildRef);
		// (intake leaves the checkout on its own branch; ensure it exists locally)
		expect(gitIn(['branch', '--list', intakeRef], repo).trim()).not.toBe('');
		// Return to main so `do` can claim + onboard cleanly.
		gitIn(['switch', '-q', 'main'], repo);
		gitIn(['merge', '-q', '--ff-only', `${ARBITER}/main`], repo);

		// 2. `do slice:<slug>` for the SAME slug, SAME checkout. Pre-rename this hit
		//    the collision: the stale `work/<slug>` was reused, the build landed on a
		//    pre-claim base, and the done-move errored "nothing to complete". Now the
		//    build is on the DISTINCT `work/task-<slug>` off the claim commit.
		const result = await performDo({
			arg: `task:${slug}`,
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(result.message).not.toMatch(/nothing to complete/i);
		// The slice landed in done/ on the arbiter, and the build ran on the build
		// ref (not the intake ref).
		expect(existsOnArbiterMain(repo, 'done', slug)).toBe(true);
		expect(result.branch).toBe(buildRef);
	});
});

/**
 * The smallest issue seam `performIntake` needs: a canned open issue, no-op
 * comments/labels/close. (The full collision regression only needs intake to
 * PRODUCE the slice + leave its branch; it does not assert on issue side-effects.)
 */
function minimalIssueProvider(): IssueProvider {
	const labels: string[] = [];
	return {
		name: 'stub',
		async getIssue({issueNumber}) {
			return {
				number: issueNumber,
				title: 'Add a --quiet flag to the CLI',
				body: 'It should suppress the progress notes.',
				author: 'octocat',
				state: 'open' as const,
			};
		},
		async listComments() {
			return [];
		},
		async postIssueComment(input) {
			return {posted: true, instruction: `commented on #${input.issueNumber}`};
		},
		async closeIssue(input) {
			return {closed: true, instruction: `closed #${input.issueNumber}`};
		},
		async getLabels() {
			return {
				outcome: 'ok' as const,
				supported: true,
				labels: [...labels],
				instruction: 'labels',
			};
		},
		async addLabel({label}) {
			labels.push(label);
			return {outcome: 'ok' as const, supported: true, instruction: 'added'};
		},
		async removeLabel({label}) {
			const i = labels.indexOf(label);
			if (i >= 0) {
				labels.splice(i, 1);
			}
			return {outcome: 'ok' as const, supported: true, instruction: 'removed'};
		},
	};
}
