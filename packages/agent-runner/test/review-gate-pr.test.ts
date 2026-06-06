import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {performDo, type DoAgentRunner} from '../src/do.js';
import {performComplete} from '../src/complete.js';
import {performClaim} from '../src/claim-cas.js';
import type {ReviewGate, ReviewVerdict} from '../src/review-gate.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * Gate 2 (PR/code review) on the `do`/`complete` pipeline — the WIRING tests.
 * House style: a throwaway checkout + a local `--bare` arbiter + a STUBBED agent
 * (edits files directly) + a STUBBED review gate (returns a canned
 * approve/block verdict — NO real model). It drives real git + writes `main`
 * (the autonomous needs-attention surfacing), so it lives in the non-parallel
 * project.
 *
 * The determinism floor (ADR §8) is asserted intact: `verify` ALWAYS runs first
 * and is never replaced by the review; review is a JUDGEMENT gate ON TOP. The
 * real `~/.agent-runner/` + `~/.pi/agent/sessions/` are untouched (the stubbed
 * gate runs no real launch; the do/complete machinery already isolates state).
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-review-pr-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';
const PASS = 'exit 0';
const FAIL = 'exit 1';

function currentBranch(repo: string): string {
	return gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim();
}

/** A stubbed agent that edits a file (non-empty commit) and succeeds. */
const editingAgent: DoAgentRunner = ({cwd}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
	return {ok: true};
};

/**
 * A stubbed review gate returning a fixed verdict — a CALLABLE that also exposes
 * the invocation log (`calls`/`rounds`/`models`) so call sites can pass it as
 * `reviewGate` directly and still assert on its invocations.
 */
type StubGate = ReviewGate & {
	readonly calls: number;
	readonly rounds: number[];
	readonly models: (string | undefined)[];
};
function stubGate(verdict: ReviewVerdict): StubGate {
	const rounds: number[] = [];
	const models: (string | undefined)[] = [];
	const gate = (async (input) => {
		rounds.push(input.round);
		models.push(input.reviewModel);
		return verdict;
	}) as StubGate;
	Object.defineProperties(gate, {
		calls: {get: () => rounds.length},
		rounds: {get: () => rounds},
		models: {get: () => models},
	});
	return gate;
}

const APPROVE: ReviewVerdict = {verdict: 'approve', findings: []};
const BLOCK: ReviewVerdict = {
	verdict: 'block',
	findings: [
		{
			severity: 'blocking',
			question: 'the diff does not reach the slice goal',
			context: 'agent-output.txt',
		},
	],
};

describe('Gate 2 — approve proceeds to integrate (autoMerge gates the merge)', () => {
	it('reviewPr on + APPROVE + autoMerge on + merge ⇒ work merges autonomously', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const gate = stubGate(APPROVE);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			reviewPr: true,
			autoMerge: true,
			reviewGate: gate,
			agentRunner: editingAgent,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		// The review gate ran (after verify, before the done-move).
		expect(gate.calls).toBe(1);
		// approve + autoMerge on + merge ⇒ landed on the arbiter's main, in done/.
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		expect(
			gitIn(['cat-file', '-e', 'arbiter/main:agent-output.txt'], repo),
		).toBe('');
		expect(currentBranch(repo)).toBe('main');
	});

	it('reviewPr on + APPROVE + autoMerge OFF + merge ⇒ review gates, the merge is DOWNGRADED to propose (a human merges)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const gate = stubGate(APPROVE);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			reviewPr: true,
			autoMerge: false, // the merge must NOT happen autonomously
			reviewGate: gate,
			agentRunner: editingAgent,
			env: gitEnv(),
		});

		expect(result.outcome).toBe('completed');
		expect(gate.calls).toBe(1);
		// autoMerge off ⇒ NOT auto-merged: the work CODE is on a pushed branch, the
		// item is in-progress on main (the claim), NOT done — a human does the merge.
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(true);
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(
			gitIn(['ls-tree', 'arbiter/main', 'agent-output.txt'], repo).trim(),
		).toBe('');
		// The work branch was pushed (the propose safety-bearing step).
		expect(
			gitIn(
				['rev-parse', '--verify', '--quiet', 'arbiter/work/alpha'],
				repo,
			).trim(),
		).not.toBe('');
	});

	it('reviewPr on + APPROVE + propose integration ⇒ proposes unchanged (no auto-merge regardless)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const gate = stubGate(APPROVE);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			verify: PASS,
			reviewPr: true,
			autoMerge: true, // even with autoMerge on, propose stays propose
			reviewGate: gate,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(true);
	});
});

describe('Gate 2 — block routes to needs-attention and NEVER merges', () => {
	it('reviewPr on + BLOCK + autoMerge on + merge ⇒ needs-attention, NOT merged, exit 1, findings in the body', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const gate = stubGate(BLOCK);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			reviewPr: true,
			autoMerge: true, // a BLOCK never auto-merges regardless of autoMerge
			reviewGate: gate,
			agentRunner: editingAgent,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('needs-attention');
		// Routed via the SAME needs-attention machinery the red gate uses, SURFACED
		// on the arbiter main (autonomous `do` passes surfaceArbiter).
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		// The work never reached main (NO merge of a blocked review).
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(
			gitIn(['ls-tree', 'arbiter/main', 'agent-output.txt'], repo).trim(),
		).toBe('');
		// The blocking findings are recorded in the item body (the reason).
		const body = gitIn(
			['show', 'arbiter/main:work/needs-attention/alpha.md'],
			repo,
		);
		expect(body).toMatch(/does not reach the slice goal/);
	});

	it('a non-approve verdict NEVER auto-merges (autoMerge on, but verdict block)', async () => {
		// Belt-and-braces of the criterion: with autoMerge ON, a block must still
		// route to needs-attention and leave main clean.
		const {repo} = seedRepoWithArbiter(scratch.root, ['beta']);
		const gate = stubGate(BLOCK);
		const result = await performDo({
			arg: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			reviewPr: true,
			autoMerge: true,
			reviewGate: gate,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('needs-attention');
		expect(existsOnArbiterMain(repo, 'done', 'beta')).toBe(false);
	});

	it('human `complete` BLOCK routes LOCAL-ONLY (no surfaceArbiter) ⇒ main not surfaced', async () => {
		// Mirrors the do.test gate-fail contrast: the human path passes no
		// surfaceArbiter, so a block bounces locally but does not surface on main.
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
		writeFileSync(join(repo, 'agent-output.txt'), 'work\n');

		const result = await performComplete({
			slug: 'gamma',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			reviewPr: true,
			reviewGate: stubGate(BLOCK),
			// NB: no surfaceArbiter — the human path.
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('review-blocked');
		expect(result.routedToNeedsAttention).toBe(true);
		// Local bounce; main still shows the in-progress claim (no surfacing).
		expect(existsSync(join(repo, 'work', 'needs-attention', 'gamma.md'))).toBe(
			true,
		);
		expect(existsOnArbiterMain(repo, 'in-progress', 'gamma')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'gamma')).toBe(false);
	});
});

describe('Gate 2 — verify is the non-skippable floor, review is ON TOP', () => {
	it('verify runs FIRST: a RED gate routes to needs-attention and the review NEVER runs', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const gate = stubGate(APPROVE); // would approve — but must never be reached
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: FAIL, // the deterministic floor is RED
			reviewPr: true,
			autoMerge: true,
			reviewGate: gate,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('needs-attention');
		// The review was NEVER invoked — verify is the floor, run first; a red gate
		// short-circuits before the judgement gate (review never replaces verify).
		expect(gate.calls).toBe(0);
		// Surfaced as a gate failure (not a review block).
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
	});

	it('both run, in order, on the happy path: verify (green) THEN review (approve) THEN integrate', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// A verify command that APPENDS a marker so we can prove it ran before the
		// review gate observed the tree.
		let verifyRanBeforeReview = false;
		const gate: ReviewGate = async () => {
			// By the time the review runs, verify has already passed (the marker file
			// the verify command wrote exists in the checkout).
			verifyRanBeforeReview = existsSync(join(repo, 'verify-ran.marker'));
			return APPROVE;
		};
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'touch verify-ran.marker',
			reviewPr: true,
			autoMerge: true,
			reviewGate: gate,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(verifyRanBeforeReview).toBe(true);
	});

	it('reviewPr OFF ⇒ the review gate is NEVER invoked (default behaviour unchanged)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const gate = stubGate(BLOCK); // would block — but must never run
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			reviewPr: false, // Gate 2 off
			reviewGate: gate,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(gate.calls).toBe(0);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
	});
});

describe('Gate 2 — reviewModel reaches the gate; reviewMaxRounds bounds the loop', () => {
	it('the reviewModel override is passed to the gate (the launch seam)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const gate = stubGate(APPROVE);
		await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			reviewPr: true,
			autoMerge: true,
			reviewModel: 'review/override',
			reviewGate: gate,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(gate.models).toEqual(['review/override']);
	});

	it('reviewMaxRounds exhaustion: a persistent BLOCK loops the bound then forces needs-attention (exit 1)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const gate = stubGate(BLOCK); // always blocks → never approves
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			reviewPr: true,
			autoMerge: true,
			reviewMaxRounds: 3,
			reviewGate: gate,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		// Drove the loop to exhaustion: the gate was invoked exactly reviewMaxRounds
		// times (rounds 1,2,3), never approved, then forced needs-attention.
		expect(gate.calls).toBe(3);
		expect(gate.rounds).toEqual([1, 2, 3]);
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('needs-attention');
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
		// The exhaustion reason is recorded (never a silent merge/loop).
		const body = gitIn(
			['show', 'arbiter/main:work/needs-attention/alpha.md'],
			repo,
		);
		expect(body).toMatch(/reviewMaxRounds=3/);
	});

	it('reviewMaxRounds default (2): a persistent block invokes the gate twice then bounces', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const gate = stubGate(BLOCK);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			reviewPr: true,
			reviewGate: gate,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(gate.calls).toBe(2); // the default bound
		expect(result.outcome).toBe('needs-attention');
	});
});

describe('Gate 2 — reviewPr on with no gate wired is a loud usage error', () => {
	it('errors clearly (the floor must not be silently skipped)', async () => {
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
		writeFileSync(join(repo, 'agent-output.txt'), 'work\n');

		const result = await performComplete({
			slug: 'gamma',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			reviewPr: true,
			// reviewGate intentionally omitted.
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/review gate is configured|wiring bug/i);
	});
});

describe('Gate 2 — test isolation (real shared dirs untouched)', () => {
	it('the stubbed review gate writes nothing to ~/.agent-runner or ~/.pi/agent/sessions', async () => {
		// The do/complete machinery already isolates workspacesDir + uses a temp
		// arbiter; the stubbed review gate runs NO real launch. Assert the real
		// shared dirs' contents are unchanged across an approve run.
		const before = snapshotDir(join(homedir(), '.agent-runner'));
		const beforePi = snapshotDir(join(homedir(), '.pi', 'agent', 'sessions'));
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			reviewPr: true,
			autoMerge: true,
			reviewGate: stubGate(APPROVE),
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(snapshotDir(join(homedir(), '.agent-runner'))).toEqual(before);
		expect(snapshotDir(join(homedir(), '.pi', 'agent', 'sessions'))).toEqual(
			beforePi,
		);
	});
});

/** A cheap directory snapshot (sorted entry names) for the untouched assertion. */
function snapshotDir(dir: string): string[] {
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir).sort();
}
