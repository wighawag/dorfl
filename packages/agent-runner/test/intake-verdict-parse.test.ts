import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {performIntake, parseIntakeVerdict} from '../src/intake.js';
import {
	type Issue,
	type IssueComment,
	type IssueProvider,
	type PostIssueCommentInput,
} from '../src/issue-provider.js';
import type {Harness} from '../src/harness.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `intake-production-verdict-parse` (PRD `issue-intake`, US #6 — "run LOCALLY
 * one-shot"): the PRODUCTION wire between the decision agent's emitted text and the
 * `IntakeVerdict` the (already-built) dispatcher consumes. Two seams are exercised
 * here, exactly as the slice's "SEAM TO TEST AT" prescribes:
 *
 *  1. `parseIntakeVerdict` as a PARSE TABLE — the four outcomes pulled out of
 *     prose-wrapped + fenced agent output, plus the three throw cases. This is the
 *     twin of the review gate's `parseReviewVerdict`; the model's JUDGEMENT is NOT
 *     unit-tested (only the parse), exactly as the review prompt's is not.
 *  2. A STUBBED-HARNESS end-to-end (NO injected `decide`): a spy harness returns
 *     `launched.output` text and `runDecision` parses it. A real-path `slice`
 *     verdict emits the backlog slice + `issue: N` + the propose PR; a malformed
 *     output degrades to `agent-failed` (exit 1), not a crash.
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-intake-parse-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

const ARBITER = 'arbiter';

// ---------------------------------------------------------------------------
// 1. parseIntakeVerdict — the parse table (four outcomes + three throw cases).
// ---------------------------------------------------------------------------
describe('parseIntakeVerdict — the parse table', () => {
	it('parses a `slice` verdict out of prose-wrapped + fenced output', () => {
		const output = [
			'Here is my decision for the issue.',
			'',
			'```json',
			JSON.stringify({
				outcome: 'slice',
				sliceSlug: 'add-quiet-flag',
				sliceTitle: 'Add a --quiet flag',
				sliceBody: '## What to build\n\nA --quiet flag.',
			}),
			'```',
			'',
			'That is the slice.',
		].join('\n');
		const v = parseIntakeVerdict(output);
		expect(v.outcome).toBe('slice');
		expect(v.sliceSlug).toBe('add-quiet-flag');
		expect(v.sliceTitle).toBe('Add a --quiet flag');
		expect(v.sliceBody).toBe('## What to build\n\nA --quiet flag.');
	});

	it('parses a `prd` verdict including the gate axes', () => {
		const output = [
			'```json',
			JSON.stringify({
				outcome: 'prd',
				prdSlug: 'big-feature',
				prdTitle: 'A big coherent feature',
				prdBody: '## Problem Statement\n\nIt is big.',
				prdHumanOnly: true,
				prdNeedsAnswers: true,
			}),
			'```',
		].join('\n');
		const v = parseIntakeVerdict(output);
		expect(v.outcome).toBe('prd');
		expect(v.prdSlug).toBe('big-feature');
		expect(v.prdTitle).toBe('A big coherent feature');
		expect(v.prdBody).toBe('## Problem Statement\n\nIt is big.');
		expect(v.prdHumanOnly).toBe(true);
		expect(v.prdNeedsAnswers).toBe(true);
	});

	it('parses an `ask` verdict (question only)', () => {
		const output =
			'I cannot act yet.\n\n```json\n{"outcome":"ask","question":"Which CLI?"}\n```';
		const v = parseIntakeVerdict(output);
		expect(v.outcome).toBe('ask');
		expect(v.question).toBe('Which CLI?');
	});

	it('parses a `bounce` verdict (message only)', () => {
		const output =
			'{"outcome":"bounce","bounceMessage":"Please file separate issues."}';
		const v = parseIntakeVerdict(output);
		expect(v.outcome).toBe('bounce');
		expect(v.bounceMessage).toBe('Please file separate issues.');
	});

	it('tolerates missing OPTIONALS (the dispatcher has fallbacks)', () => {
		// A `slice` with no slug/body — the dispatcher derives a slug from the title.
		const v = parseIntakeVerdict(
			'{"outcome":"slice","sliceTitle":"Only a title"}',
		);
		expect(v.outcome).toBe('slice');
		expect(v.sliceTitle).toBe('Only a title');
		expect(v.sliceSlug).toBeUndefined();
		expect(v.sliceBody).toBeUndefined();
	});

	it('THROWS when no JSON object is present', () => {
		expect(() =>
			parseIntakeVerdict('just some prose, no verdict here'),
		).toThrow(/no parseable/i);
	});

	it('THROWS on invalid JSON', () => {
		// An `"outcome"` key is present (so the span is found) but the object is
		// malformed (a trailing comma) — JSON.parse fails.
		expect(() =>
			parseIntakeVerdict('```json\n{"outcome":"slice",}\n```'),
		).toThrow(/not valid JSON/i);
	});

	it('THROWS on an outcome not in {ask,slice,prd,bounce}', () => {
		expect(() => parseIntakeVerdict('{"outcome":"merge"}')).toThrow(
			/ask\|slice\|prd\|bounce/,
		);
	});
});

// ---------------------------------------------------------------------------
// 2. The STUBBED-HARNESS end-to-end (NO injected `decide`): runDecision launches
//    the harness, reads `launched.output`, parses + dispatches it.
// ---------------------------------------------------------------------------

/** A stubbed issue seam (no `gh`/network): canned issue, in-memory labels. */
function stubIssueProvider(): IssueProvider & {
	readonly comments: PostIssueCommentInput[];
} {
	const comments: PostIssueCommentInput[] = [];
	const labels: string[] = [];
	const provider: IssueProvider & {comments: PostIssueCommentInput[]} = {
		name: 'stub',
		comments,
		async getIssue({issueNumber}): Promise<Issue> {
			return {
				number: issueNumber,
				title: 'Add a --quiet flag to the CLI',
				body: 'It should suppress the progress notes.',
				author: 'octocat',
				state: 'open',
			};
		},
		async listComments(): Promise<IssueComment[]> {
			return [];
		},
		async postIssueComment(input) {
			comments.push(input);
			return {posted: true, instruction: `commented on #${input.issueNumber}`};
		},
		async closeIssue({issueNumber}) {
			return {closed: true, instruction: `closed #${issueNumber}`};
		},
		async getLabels() {
			return {supported: true, labels: [...labels], instruction: 'read labels'};
		},
		async addLabel({label}) {
			if (!labels.includes(label)) {
				labels.push(label);
			}
			return {applied: true, instruction: `added ${label}`};
		},
		async removeLabel({label}) {
			const i = labels.indexOf(label);
			if (i !== -1) {
				labels.splice(i, 1);
			}
			return {applied: true, instruction: `removed ${label}`};
		},
	};
	return provider;
}

/**
 * A spy harness whose `launch` returns the agent's emitted verdict text on the
 * ANSWER channel (`output`) — exactly how the production path recovers a verdict.
 * No real model/network; the same shape `review-gate.test.ts` uses.
 */
function spyHarness(output: string): Harness {
	return {
		adapter: 'spy',
		launch() {
			return {ok: true, record: {adapter: 'spy'}, output};
		},
		launchInteractive() {
			throw new Error('stub harness does not launch interactively');
		},
		isAlive: () => false,
	};
}

describe('intake <N> — the PRODUCTION verdict wire (stubbed harness, no injected decide)', () => {
	it('a real-path `slice` verdict on launched.output is PARSED + DISPATCHED (backlog slice + issue: N + propose PR)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider();
		// The agent emits a fenced verdict block wrapped in prose — the realistic shape.
		const agentOutput = [
			'I read the issue and its thread. This is a single clear ask.',
			'',
			'```json',
			JSON.stringify({
				outcome: 'slice',
				sliceSlug: 'add-quiet-flag',
				sliceTitle: 'Add a --quiet flag to suppress progress notes',
				sliceBody: [
					'## What to build',
					'',
					'A --quiet flag that suppresses the progress notes.',
					'',
					'## Acceptance criteria',
					'',
					'- [ ] --quiet suppresses the notes',
					'',
					'## Prompt',
					'',
					'> Add a --quiet flag.',
				].join('\n'),
			}),
			'```',
		].join('\n');

		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			// NO `decide` — production wires the harness; the verdict rides `output`.
			harness: spyHarness(agentOutput),
			// Stub the lone-slice review seam to CONVERGE (this test exercises the
			// DECISION verdict wire, not the bounded review — the review's own
			// production wire is tested separately). The spy harness returns an
			// `{outcome:…}` block (not a `{verdict:…}` one), so without this stub the
			// review parse would degrade to agent-failed.
			reviewSlice: async () => ({verdict: 'approve', findings: []}),
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('sliced');
		expect(result.emittedSlug).toBe('add-quiet-flag');
		expect(result.emitted).toBe('work/backlog/add-quiet-flag.md');

		// PROPOSE (default): the slice rides the work/<slug> branch; main untouched.
		expect(existsOnArbiterMain(repo, 'backlog', 'add-quiet-flag')).toBe(false);
		gitIn(['fetch', '-q', ARBITER], repo);
		const onBranch = gitIn(
			[
				'show',
				`${ARBITER}/work/intake-slice-add-quiet-flag:work/backlog/add-quiet-flag.md`,
			],
			repo,
		);
		expect(onBranch).toContain('slug: add-quiet-flag');
		expect(onBranch).toMatch(/^issue: 42$/m);
		expect(onBranch).toContain('covers: []');
		expect(onBranch).not.toMatch(/^prd:/m);
		expect(onBranch).not.toContain('Fixes');
		// The AGENT posted nothing itself (runner owns seams); on a SUCCESSFUL slice the
		// RUNNER posts exactly ONE informational `slice created` completion comment.
		expect(issueProvider.comments).toHaveLength(1);
		expect(issueProvider.comments[0].body).toContain('Created slice');
	});

	it('a MALFORMED launched.output degrades to `agent-failed` (exit 1), not a crash', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await performIntake({
			issueNumber: 7,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: stubIssueProvider(),
			// No parseable verdict in the agent's output — the parse throws, and
			// decideAndDispatch's try/catch maps it onto agent-failed (exit 1).
			harness: spyHarness('I thought about it but emitted no verdict block.'),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('agent-failed');
		expect(result.message).toContain('#7');
	});
});
