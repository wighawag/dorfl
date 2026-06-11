import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {
	writeFileSync,
	chmodSync,
	readFileSync,
	existsSync,
	mkdirSync,
} from 'node:fs';
import {
	performIntake,
	composeIntakeCompletionComment,
	type IntakeVerdict,
} from '../src/intake.js';
import {stampIntakeMarker, parseIntakeMarker} from '../src/intake-marker.js';
import {brand} from '../src/brand.js';
import {
	GitHubIssueProvider,
	PROCESSING_LOCK_LABEL,
	type Issue,
	type IssueComment,
	type IssueProvider,
	type PostIssueCommentInput,
	type CloseIssueInput,
} from '../src/issue-provider.js';
import {mergeConfig} from '../src/config.js';
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
 * `intake-tracer-slice-outcome` (PRD `issue-intake`): the KEYSTONE `intake <N>`
 * one-shot — read an issue via the issue SEAM → prompt→verdict → DISPATCH the
 * `slice` outcome through `performIntegration`.
 *
 * House style (mirrors `run-integration-core.test.ts` / `review-gate-pr-comment.test.ts`):
 * a throwaway project checkout + a local `--bare` arbiter (`seedRepoWithArbiter`),
 * `gitEnv()` for `GIT_CONFIG_GLOBAL` isolation, and the SEAMs STUBBED — the issue
 * seam (no `gh`/network) + a CANNED verdict driving the dispatcher (no model). The
 * dispatcher is the testable seam; the prompt's JUDGEMENT is never unit-tested.
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-intake-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * A stubbed issue seam: canned issue + thread, recording its posted comments AND
 * its label mutations (the `processing` lock). The label set is in-memory and the
 * ops mutate it, so a test can assert the lock is present DURING the run and absent
 * AFTER it, observe a second run backing off, and — via `noLabels` — model a
 * non-label provider that DEGRADES to best-effort.
 */
function stubIssueProvider(
	opts: {
		issue?: Partial<Issue>;
		comments?: IssueComment[];
		/** Seed the issue's labels (e.g. the lock already held by a concurrent run). */
		labels?: string[];
		/** Model a provider with NO label concept (degrade to best-effort). */
		noLabels?: boolean;
	} = {},
): IssueProvider & {
	readonly comments: PostIssueCommentInput[];
	readonly labels: string[];
	readonly labelOps: string[];
	readonly closes: CloseIssueInput[];
} {
	const comments: PostIssueCommentInput[] = [];
	const labels: string[] = [...(opts.labels ?? [])];
	const labelOps: string[] = [];
	const closes: CloseIssueInput[] = [];
	const provider: IssueProvider & {
		comments: PostIssueCommentInput[];
		labels: string[];
		labelOps: string[];
		closes: CloseIssueInput[];
	} = {
		name: 'stub',
		comments,
		labels,
		labelOps,
		closes,
		async getIssue({issueNumber}) {
			return {
				number: issueNumber,
				title: 'Add a --quiet flag to the CLI',
				body: 'It should suppress the progress notes.',
				author: 'octocat',
				state: 'open',
				...opts.issue,
			};
		},
		async listComments() {
			return opts.comments ?? [];
		},
		async postIssueComment(input) {
			comments.push(input);
			return {posted: true, instruction: `commented on #${input.issueNumber}`};
		},
		async closeIssue(input) {
			closes.push(input);
			return {closed: true, instruction: `closed #${input.issueNumber}`};
		},
		async getLabels() {
			if (opts.noLabels) {
				return {
					outcome: 'unsupported' as const,
					supported: false,
					labels: [],
					instruction: 'no label support',
				};
			}
			return {
				outcome: 'ok' as const,
				supported: true,
				labels: [...labels],
				instruction: 'read labels',
			};
		},
		async addLabel({label}) {
			if (opts.noLabels) {
				return {
					outcome: 'unsupported' as const,
					applied: false,
					instruction: 'no label support',
				};
			}
			labelOps.push(`add:${label}`);
			if (!labels.includes(label)) {
				labels.push(label);
			}
			return {
				outcome: 'applied' as const,
				applied: true,
				instruction: `added ${label}`,
			};
		},
		async removeLabel({label}) {
			if (opts.noLabels) {
				return {
					outcome: 'unsupported' as const,
					applied: false,
					instruction: 'no label support',
				};
			}
			labelOps.push(`remove:${label}`);
			const i = labels.indexOf(label);
			if (i !== -1) {
				labels.splice(i, 1);
			}
			return {
				outcome: 'applied' as const,
				applied: true,
				instruction: `removed ${label}`,
			};
		},
	};
	return provider;
}

/**
 * A canned CONVERGING lone-slice review gate (the STUBBED review seam — no
 * model/network): every round `approve`s with no blocking finding and proposes no
 * edit, so the drafted slice is emitted unchanged. The bounded review
 * (`intake-lone-slice-bounded-internal-review`) is ALWAYS ON (ruling B), so every
 * slice-outcome test must drive this new seam alongside the decision seam.
 */
const convergingReviewGate: import('../src/intake.js').LoneSliceReviewGate =
	async () => ({verdict: 'approve', findings: []});

/** A canned `slice` verdict (the STUBBED decision seam — no model/network). */
const SLICE_VERDICT: IntakeVerdict = {
	outcome: 'slice',
	sliceSlug: 'add-quiet-flag',
	sliceTitle: 'Add a --quiet flag to suppress progress notes',
	sliceBody: [
		'## What to build',
		'',
		'A --quiet flag on the CLI that suppresses the progress notes.',
		'',
		'## Acceptance criteria',
		'',
		'- [ ] --quiet suppresses the >> notes',
		'',
		'## Prompt',
		'',
		'> Add a --quiet flag.',
	].join('\n'),
};

describe('intake <N> — the slice-outcome dispatcher (stubbed seams)', () => {
	it('a stubbed `slice` verdict writes work/backlog/<slug>.md (issue: N, covers: [], no prd:, NO Fixes) and proposes a PR (main untouched)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider();

		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => SLICE_VERDICT,
			reviewSlice: convergingReviewGate,
			// default integration (propose); no provider override (file:// ⇒ none)
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('sliced');
		expect(result.emittedSlug).toBe('add-quiet-flag');
		expect(result.emitted).toBe('work/backlog/add-quiet-flag.md');

		// PROPOSE (default): the slice rides the work/<slug> branch on the arbiter,
		// and main is NOT touched (no done/backlog slice landed on main).
		expect(existsOnArbiterMain(repo, 'backlog', 'add-quiet-flag')).toBe(false);
		gitIn(['fetch', '-q', ARBITER], repo);
		const branchTip = gitIn(
			[
				'rev-parse',
				'--verify',
				'--quiet',
				`${ARBITER}/work/intake-slice-add-quiet-flag`,
			],
			repo,
		).trim();
		expect(branchTip).not.toBe('');

		// The slice file ON THAT BRANCH carries the lone-slice `issue: N` closure link
		// (read by a future CI close-job), covers: [], and NO prd: — and NO `Fixes #N`
		// (a deferred GitHub-only optimisation, dropped from intake).
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
	});

	it('is GATE-FREE: it proceeds with the autonomous gates (allowAgents/autoSlice) OFF', async () => {
		// Prove `intake` does not consult the autonomous-selection gates: even with a
		// per-repo config that turns the build gate (allowAgents) AND the slice gate
		// (autoSlice) OFF, the explicit invocation authorizes the run and the slice is
		// emitted. (`intake` takes NO autonomy config at all — the explicit invocation
		// IS the authorization, exactly as `do`; the gates are the autonomous path's.)
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const config = mergeConfig({allowAgents: false, autoSlice: false});
		// `intake` never reads these; we assert the run SUCCEEDS regardless — the
		// gate-free property (PRD US #7).
		void config;

		const result = await performIntake({
			issueNumber: 7,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: stubIssueProvider({issue: {number: 7}}),
			decide: async () => SLICE_VERDICT,
			reviewSlice: convergingReviewGate,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('sliced');
		expect(result.emitted).toBe('work/backlog/add-quiet-flag.md');
	});

	it('the AGENT does no git and no seam side-effects: the runner posts nothing and the decider sees no git', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider();

		// The decider (the "agent" boundary) returns a verdict and is given NO way to
		// touch git or post: it only reads the issue/thread/prompt. Capture the repo
		// HEAD at decision time to prove the agent makes no commits.
		let headAtDecision = '';
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async ({cwd}) => {
				headAtDecision = gitIn(['rev-parse', 'HEAD'], cwd).trim();
				return SLICE_VERDICT;
			},
			reviewSlice: convergingReviewGate,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);

		// The AGENT (decider) posted NO issue comment itself — the runner owns every
		// seam side-effect. On a SUCCESSFUL slice the RUNNER posts exactly ONE
		// informational completion comment AFTER the integrate (this slice); the agent
		// stays seam-free (it returned a verdict and touched no git/seam).
		expect(issueProvider.comments).toHaveLength(1);
		expect(issueProvider.comments[0].body).toContain('Created slice');

		// The decider observed a HEAD; the WRITE/commit happened only AFTER (the
		// runner onboarded a work branch + integrated). The decider itself authored
		// no commit: the work/<slug> branch's parent is the original main tip the
		// decider saw, i.e. exactly one runner-owned commit on top.
		expect(headAtDecision).not.toBe('');
		gitIn(['fetch', '-q', ARBITER], repo);
		const branchCommits = gitIn(
			[
				'rev-list',
				'--count',
				`${ARBITER}/main..${ARBITER}/work/intake-slice-add-quiet-flag`,
			],
			repo,
		).trim();
		expect(branchCommits).toBe('1');
	});

	it('derives a content-derived slug from the verdict TITLE when no slug is drafted (never a counter)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await performIntake({
			issueNumber: 3,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: stubIssueProvider({issue: {number: 3}}),
			decide: async () => ({
				outcome: 'slice',
				sliceTitle: 'Fix the Broken Login Button',
				sliceBody: undefined,
			}),
			reviewSlice: convergingReviewGate,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		// Content-derived (paramCase of the title), NOT an issue-number counter.
		expect(result.emittedSlug).toBe('fix-the-broken-login-button');
		expect(result.emittedSlug).not.toContain('3');
	});

	it('a read failure on the issue seam surfaces as a usage error (intake cannot decide)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const failingProvider: IssueProvider = {
			name: 'failing',
			async getIssue() {
				throw new Error('gh exited 1 — is gh authenticated?');
			},
			async listComments() {
				return [];
			},
			async postIssueComment() {
				return {posted: false, instruction: 'n/a'};
			},
			async closeIssue() {
				return {closed: false, instruction: 'n/a'};
			},
			async getLabels() {
				return {
					outcome: 'ok' as const,
					supported: true,
					labels: [],
					instruction: 'n/a',
				};
			},
			async addLabel() {
				return {outcome: 'applied' as const, applied: true, instruction: 'n/a'};
			},
			async removeLabel() {
				return {outcome: 'applied' as const, applied: true, instruction: 'n/a'};
			},
		};
		const result = await performIntake({
			issueNumber: 99,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: failingProvider,
			decide: async () => SLICE_VERDICT,
			reviewSlice: convergingReviewGate,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toContain('#99');
	});
});

// ---------------------------------------------------------------------------
// The FULL four-outcome dispatcher (ask / prd / bounce) under STUBBED verdicts
// (`intake-decision-prompt-and-four-outcome-dispatch`). Each verdict drives the
// right action; the prompt's JUDGEMENT is never unit-tested — only the dispatch.
// ---------------------------------------------------------------------------
describe('intake <N> — the four-outcome dispatcher (stubbed verdicts)', () => {
	it('a stubbed `ask` verdict posts the clarifying question and emits NOTHING (no file, no integrate, issue stays open)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider({issue: {number: 9}});
		const result = await performIntake({
			issueNumber: 9,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => ({
				outcome: 'ask',
				question: 'Which exact notes should --quiet suppress?',
			}),
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('asked');
		// A comment was posted with the question text.
		expect(issueProvider.comments).toHaveLength(1);
		expect(issueProvider.comments[0].issueNumber).toBe(9);
		expect(issueProvider.comments[0].body).toContain('Which exact notes');
		// NO artifact emitted, NO integrate.
		expect(result.emitted).toBeUndefined();
		expect(result.emittedSlug).toBeUndefined();
		expect(existsOnArbiterMain(repo, 'backlog', 'add-quiet-flag')).toBe(false);
		// The issue is left OPEN: nothing closes it (intake never closes). No work
		// branch was even pushed for the ask outcome (no integrate ran).
		gitIn(['fetch', '-q', ARBITER], repo);
		const remoteBranches = gitIn(['branch', '-r'], repo);
		expect(remoteBranches).not.toContain(
			`${ARBITER}/work/intake-slice-add-quiet-flag`,
		);
	});

	it('a stubbed `bounce` verdict CLOSES the issue ATOMICALLY (bounce text as closing comment + reason not planned), emits NOTHING — no separate postIssueComment', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider({issue: {number: 11}});
		const result = await performIntake({
			issueNumber: 11,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => ({
				outcome: 'bounce',
				bounceMessage:
					'These are unrelated — please file separate issues for each.',
			}),
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('bounced');
		// ONE atomic close carrying the bounce text as the closing comment + reason
		// `not planned` — NOT a separate postIssueComment then close.
		expect(issueProvider.closes).toHaveLength(1);
		expect(issueProvider.closes[0].issueNumber).toBe(11);
		expect(issueProvider.closes[0].comment).toContain('separate issues');
		expect(issueProvider.closes[0].reason).toBe('not planned');
		// The bounce path does NOT post a separate comment (the close carries it).
		expect(issueProvider.comments).toHaveLength(0);
		// The result surfaces the close (additive `closed`, mirroring `commented`).
		expect(result.closed).toBe(true);
		// NO artifact; main untouched.
		expect(result.emitted).toBeUndefined();
		expect(existsOnArbiterMain(repo, 'backlog', 'add-quiet-flag')).toBe(false);
	});

	it('a close DEGRADE (gh missing/unauth) on a bounce does NOT change the terminal outcome (bounced, exit 0) and surfaces the REAL cause', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const base = stubIssueProvider({issue: {number: 11}});
		const notes: string[] = [];
		// The close FAILS for a real reason — the REAL `gh` stderr is carried in
		// `instruction`/`reason`, NOT a hard-coded "unauthenticated" guess.
		const issueProvider: IssueProvider = {
			...base,
			async closeIssue() {
				return {
					closed: false,
					reason: 'HTTP 403: Resource not accessible by integration',
					instruction:
						'could not close issue #11: HTTP 403: Resource not accessible by integration',
				};
			},
		};
		const result = await performIntake({
			issueNumber: 11,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => ({
				outcome: 'bounce',
				bounceMessage: 'Unrelated — file separate issues.',
			}),
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		// The terminal outcome is UNCHANGED by the degrade.
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('bounced');
		expect(result.closed).toBe(false);
		// The REAL cause is surfaced (diagnosable), NOT a hard-coded auth guess.
		expect(result.message).toMatch(/403/);
		expect(result.message).not.toMatch(/unavailable or unauthenticated/i);
	});

	it('ask / slice / prd NEVER close the issue (only bounce closes)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// ASK: posts a comment, no close.
		const askProvider = stubIssueProvider({issue: {number: 9}});
		const asked = await performIntake({
			issueNumber: 9,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: askProvider,
			decide: async () => ({outcome: 'ask', question: 'clarify?'}),
			env: gitEnv(),
		});
		expect(asked.outcome).toBe('asked');
		expect(askProvider.closes).toHaveLength(0);
		expect(askProvider.comments).toHaveLength(1);
		expect(asked.closed).toBeUndefined();

		// SLICE: emits a slice, no close.
		const sliceProvider = stubIssueProvider({issue: {number: 9}});
		const sliced = await performIntake({
			issueNumber: 9,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: sliceProvider,
			decide: async () => SLICE_VERDICT,
			reviewSlice: convergingReviewGate,
			env: gitEnv(),
		});
		expect(sliced.outcome).toBe('sliced');
		expect(sliceProvider.closes).toHaveLength(0);
		expect(sliced.closed).toBeUndefined();

		// PRD: emits a PRD, no close.
		const prdProvider = stubIssueProvider({issue: {number: 9}});
		const prd = await performIntake({
			issueNumber: 9,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: prdProvider,
			decide: async () => ({
				outcome: 'prd',
				prdSlug: 'quiet-and-verbose-modes',
				prdTitle: 'Quiet and verbose modes',
			}),
			env: gitEnv(),
		});
		expect(prd.outcome).toBe('prd');
		expect(prdProvider.closes).toHaveLength(0);
		expect(prd.closed).toBeUndefined();
	});

	it('a `bounce`/`ask` verdict with NO drafted message still posts a sensible default comment', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider({issue: {number: 13}});
		const asked = await performIntake({
			issueNumber: 13,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => ({outcome: 'ask'}),
			env: gitEnv(),
		});
		expect(asked.outcome).toBe('asked');
		expect(issueProvider.comments).toHaveLength(1);
		expect(issueProvider.comments[0].body.trim()).not.toBe('');

		// A bounce with NO drafted message still closes with a sensible default closing
		// comment + reason not planned.
		const bounceProvider = stubIssueProvider({issue: {number: 14}});
		const bounced = await performIntake({
			issueNumber: 14,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: bounceProvider,
			decide: async () => ({outcome: 'bounce'}),
			env: gitEnv(),
		});
		expect(bounced.outcome).toBe('bounced');
		expect(bounceProvider.closes).toHaveLength(1);
		expect((bounceProvider.closes[0].comment ?? '').trim()).not.toBe('');
		expect(bounceProvider.closes[0].reason).toBe('not planned');
	});

	it('a stubbed `prd` verdict writes work/prd/<slug>.md (issue: N, surfaced gate axes), integrates, and STOPS', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider({issue: {number: 42}});
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => ({
				outcome: 'prd',
				prdSlug: 'quiet-and-verbose-modes',
				prdTitle: 'Quiet and verbose output modes for the CLI',
				prdHumanOnly: true,
				prdNeedsAnswers: true,
				prdBody: [
					'## Problem Statement',
					'',
					'The CLI has no output-verbosity control.',
					'',
					'## Solution',
					'',
					'Add --quiet and --verbose, coupled under one vision.',
					'',
					'## User Stories',
					'',
					'1. As a user, I want --quiet.',
					'2. As a user, I want --verbose.',
				].join('\n'),
			}),
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('prd');
		expect(result.emittedSlug).toBe('quiet-and-verbose-modes');
		expect(result.emitted).toBe('work/prd/quiet-and-verbose-modes.md');

		// One informational completion comment posted (this slice): the runner reports
		// `prd created` back on the issue, framed as created (not resolved).
		expect(issueProvider.comments).toHaveLength(1);
		expect(issueProvider.comments[0].body).toContain('Created PRD');

		// PROPOSE (default): the PRD rides the work/<slug> branch; main is NOT touched.
		gitIn(['fetch', '-q', ARBITER], repo);
		const branchTip = gitIn(
			[
				'rev-parse',
				'--verify',
				'--quiet',
				`${ARBITER}/work/intake-prd-quiet-and-verbose-modes`,
			],
			repo,
		).trim();
		expect(branchTip).not.toBe('');

		// The PRD file ON THAT BRANCH carries `issue: 42` (the close-JOB linkage),
		// surfaces the gate axes the verdict judged, and is NOT sliced (no backlog
		// slices emitted alongside it).
		const onBranch = gitIn(
			[
				'show',
				`${ARBITER}/work/intake-prd-quiet-and-verbose-modes:work/prd/quiet-and-verbose-modes.md`,
			],
			repo,
		);
		expect(onBranch).toContain('slug: quiet-and-verbose-modes');
		expect(onBranch).toMatch(/^issue: 42$/m);
		expect(onBranch).toMatch(/^humanOnly: true$/m);
		expect(onBranch).toMatch(/^needsAnswers: true$/m);
		expect(onBranch).toContain('## User Stories');
		// `issue: N` lives ONLY on the PRD — there is no `Fixes #N` close marker on it
		// (that would close on the first fanned merge; the PRD is closed by CI's JOB).
		expect(onBranch).not.toContain('Fixes #42');
	});

	it('a `prd` verdict OMITS gate axes the verdict did not declare (undeclared = absent)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await performIntake({
			issueNumber: 5,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: stubIssueProvider({issue: {number: 5}}),
			decide: async () => ({
				outcome: 'prd',
				prdTitle: 'A Coupled But Small Pair',
			}),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('prd');
		// Content-derived slug from the title (never a counter).
		expect(result.emittedSlug).toBe('a-coupled-but-small-pair');
		gitIn(['fetch', '-q', ARBITER], repo);
		const onBranch = gitIn(
			[
				'show',
				`${ARBITER}/work/intake-prd-a-coupled-but-small-pair:work/prd/a-coupled-but-small-pair.md`,
			],
			repo,
		);
		expect(onBranch).toMatch(/^issue: 5$/m);
		expect(onBranch).not.toMatch(/^humanOnly:/m);
		expect(onBranch).not.toMatch(/^needsAnswers:/m);
	});

	it('the AGENT does no git/seam ops on the ask/prd/bounce branches: the decider sees no commit it authored', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider({issue: {number: 8}});
		let headAtDecision = '';
		const result = await performIntake({
			issueNumber: 8,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async ({cwd}) => {
				headAtDecision = gitIn(['rev-parse', 'HEAD'], cwd).trim();
				// The decider posts NOTHING itself — the runner owns the comment.
				return {outcome: 'ask', question: 'clarify?'};
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(headAtDecision).not.toBe('');
		// The runner (not the agent) posted exactly one comment AFTER the decision.
		expect(issueProvider.comments).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// The PROCESSING LOCK (`intake-processing-lock`, PRD US #10): a TRANSIENT
// provider-native concurrency mutex — ONE label added-on-start / removed-on-finish,
// serialising two concurrent runs on the SAME issue. NOT a `work/` CAS and NOT a
// label state-machine (ADR §12). The RUNNER owns the label ops (the agent stays
// label-free). A non-label provider DEGRADES to best-effort. Asserted at the
// STUBBED issue seam (the lock state observable on `issueProvider.labels`).
// ---------------------------------------------------------------------------
describe('intake <N> — the processing lock (acquire/release, back-off, degrade)', () => {
	it('acquires the lock on START (present DURING the run) and releases it on FINISH (absent after)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider();
		let lockHeldAtDecision = false;
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => {
				// MID-RUN: the lock label is present (the winner acquired it on start).
				lockHeldAtDecision = issueProvider.labels.includes(
					PROCESSING_LOCK_LABEL,
				);
				return SLICE_VERDICT;
			},
			reviewSlice: convergingReviewGate,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('sliced');
		// The lock was HELD during the run …
		expect(lockHeldAtDecision).toBe(true);
		// … and is RELEASED afterwards (absent on finish, so the next run can proceed).
		expect(issueProvider.labels).not.toContain(PROCESSING_LOCK_LABEL);
		// The runner performed BOTH ops, in order (acquire then release).
		expect(issueProvider.labelOps).toEqual([
			`add:${PROCESSING_LOCK_LABEL}`,
			`remove:${PROCESSING_LOCK_LABEL}`,
		]);
	});

	it('releases the lock on a HANDLED FAILURE (agent-failed) — the next run is not blocked', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider();
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => {
				throw new Error('the decision agent errored');
			},
			env: gitEnv(),
		});
		expect(result.outcome).toBe('agent-failed');
		// Even on a handled failure the lock is RELEASED (finally), so it does not leak.
		expect(issueProvider.labels).not.toContain(PROCESSING_LOCK_LABEL);
		expect(issueProvider.labelOps).toEqual([
			`add:${PROCESSING_LOCK_LABEL}`,
			`remove:${PROCESSING_LOCK_LABEL}`,
		]);
	});

	it('a SECOND run while the lock is already PRESENT backs off (does nothing — no emit, no comment, no integrate)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// Seed the lock as already held by a concurrent run.
		const issueProvider = stubIssueProvider({
			labels: [PROCESSING_LOCK_LABEL],
		});
		let decided = false;
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => {
				decided = true;
				return SLICE_VERDICT;
			},
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('locked');
		// BACK OFF: the decision never ran, nothing was emitted, no comment posted.
		expect(decided).toBe(false);
		expect(result.emitted).toBeUndefined();
		expect(issueProvider.comments).toHaveLength(0);
		expect(existsOnArbiterMain(repo, 'backlog', 'add-quiet-flag')).toBe(false);
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(gitIn(['branch', '-r'], repo)).not.toContain(
			`${ARBITER}/work/intake-slice-add-quiet-flag`,
		);
		// The loser did NOT touch the label — it is still held (only the winner removes
		// it on its own finish). No add/remove from this backed-off run.
		expect(issueProvider.labels).toContain(PROCESSING_LOCK_LABEL);
		expect(issueProvider.labelOps).toEqual([]);
	});

	it('a NON-LABEL provider DEGRADES to best-effort: the run proceeds WITHOUT the lock (no crash)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// A provider with NO label concept (getLabels reports unsupported).
		const issueProvider = stubIssueProvider({noLabels: true});
		const notes: string[] = [];
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => SLICE_VERDICT,
			reviewSlice: convergingReviewGate,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});

		// The run PROCEEDS (the slice is emitted) without a lock — no crash, no back-off.
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('sliced');
		expect(result.emitted).toBe('work/backlog/add-quiet-flag.md');
		// No label op happened (the provider has none) and the degrade is SURFACED.
		expect(issueProvider.labelOps).toEqual([]);
		expect(notes.some((n) => /lock degraded/i.test(n))).toBe(true);
	});

	it('a lock-READ FAILURE on a label-supporting provider FAILS the run (lock-failed) — it does NOT silently proceed lock-less', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const notes: string[] = [];
		let decided = false;
		// A provider that SUPPORTS labels but whose READ fails for a real reason
		// (e.g. `gh` unauthenticated) — the REAL stderr is carried in `instruction`.
		const issueProvider: IssueProvider = {
			...stubIssueProvider(),
			async getLabels() {
				return {
					outcome: 'failed' as const,
					supported: false,
					labels: [],
					reason: "'agent-runner:processing' not found",
					instruction:
						"could not read the labels on issue #40: 'agent-runner:processing' not found",
				};
			},
		};
		const result = await performIntake({
			issueNumber: 40,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => {
				decided = true;
				return SLICE_VERDICT;
			},
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		// FAIL — not a silent best-effort proceed.
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('lock-failed');
		expect(decided).toBe(false);
		expect(result.emitted).toBeUndefined();
		// The REAL cause is surfaced (diagnosable), NOT a hard-coded auth guess.
		expect(result.message).toMatch(/not found/);
		expect(result.message).not.toMatch(/unavailable or unauthenticated/i);
	});

	it('a lock-ACQUIRE FAILURE on a label-supporting provider FAILS the run (lock-failed) with the real cause', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		let decided = false;
		// READ succeeds (no lock held) but the ADD fails for a real reason — the lock
		// is meaningful but unacquirable, so the run must FAIL (not proceed lock-less).
		const base = stubIssueProvider();
		const issueProvider: IssueProvider = {
			...base,
			async addLabel() {
				return {
					outcome: 'failed' as const,
					applied: false,
					reason: 'HTTP 403: Resource not accessible by integration',
					instruction:
						'could not add the `agent-runner:processing` label on issue #40: HTTP 403: Resource not accessible by integration',
				};
			},
		};
		const result = await performIntake({
			issueNumber: 40,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => {
				decided = true;
				return SLICE_VERDICT;
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('lock-failed');
		expect(decided).toBe(false);
		expect(result.message).toMatch(/403/);
	});

	it('a release FAILURE surfaces the manual recovery command so a leaked lock is recoverable AND discoverable', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const notes: string[] = [];
		// Acquire succeeds; RELEASE fails (e.g. `gh` lost auth mid-run). The lock may be
		// left behind — the run must surface the manual `gh issue edit --remove-label`.
		const base = stubIssueProvider();
		const issueProvider: IssueProvider = {
			...base,
			async removeLabel() {
				return {
					outcome: 'failed' as const,
					applied: false,
					reason: 'HTTP 401: Bad credentials',
					instruction: 'could not remove the lock on issue #40: HTTP 401',
				};
			},
		};
		const result = await performIntake({
			issueNumber: 40,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => SLICE_VERDICT,
			reviewSlice: convergingReviewGate,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(result.outcome).toBe('sliced');
		// The release degrade is surfaced AND the manual recovery is discoverable.
		expect(notes.some((n) => /lock release degraded/i.test(n))).toBe(true);
		expect(notes.some((n) => /gh issue edit 40 --remove-label/.test(n))).toBe(
			true,
		);
	});
});

// ---------------------------------------------------------------------------
// PER-OUTCOME integration modes threaded through performIntegration
// (`intake-per-outcome-integration-modes`, PRD US #9). The PURE resolution table
// lives in `intake-integration-modes.test.ts`; HERE is the ONE end-to-end check
// that the RESOLVED mode actually reaches `performIntegration` for the emitted
// artifact: `--merge-slice` LANDS the slice on `main`; default/`--propose-slice`
// opens a PR (main untouched). ask/bounce ignore the modes (no integrate at all).
// ---------------------------------------------------------------------------
describe('intake <N> — per-outcome integration modes reach performIntegration', () => {
	it('a `slice` verdict with integration.slice=merge LANDS the slice on arbiter main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: stubIssueProvider(),
			decide: async () => SLICE_VERDICT,
			reviewSlice: convergingReviewGate,
			// The SLICE mode resolves to merge (e.g. from `--merge-slice`); the PRD mode
			// is irrelevant for a slice verdict.
			integration: {slice: 'merge', prd: 'propose'},
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('sliced');
		// MERGE: the slice landed on arbiter main (no PR; main advanced).
		expect(existsOnArbiterMain(repo, 'backlog', 'add-quiet-flag')).toBe(true);
		const onMain = gitIn(
			['show', `${ARBITER}/main:work/backlog/add-quiet-flag.md`],
			repo,
		);
		// The merged slice carries the `issue: N` closure link, not `Fixes #N` (which
		// has no PR-body slot on the merge path anyway).
		expect(onMain).toMatch(/^issue: 42$/m);
		expect(onMain).not.toContain('Fixes');
	});

	it('a `slice` verdict with integration.slice=propose opens a PR (main untouched)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: stubIssueProvider(),
			decide: async () => SLICE_VERDICT,
			reviewSlice: convergingReviewGate,
			integration: {slice: 'propose', prd: 'merge'},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('sliced');
		// PROPOSE: main is NOT touched; the slice rides the work/<slug> branch. (The
		// PRD mode being `merge` must NOT leak onto the slice path.)
		expect(existsOnArbiterMain(repo, 'backlog', 'add-quiet-flag')).toBe(false);
		gitIn(['fetch', '-q', ARBITER], repo);
		const branchTip = gitIn(
			[
				'rev-parse',
				'--verify',
				'--quiet',
				`${ARBITER}/work/intake-slice-add-quiet-flag`,
			],
			repo,
		).trim();
		expect(branchTip).not.toBe('');
	});

	it('a `prd` verdict with integration.prd=merge LANDS the PRD on arbiter main (slice mode irrelevant)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: stubIssueProvider(),
			decide: async () => ({
				outcome: 'prd',
				prdSlug: 'quiet-and-verbose-modes',
				prdTitle: 'Quiet and verbose output modes',
			}),
			// The PRD mode resolves to merge; the SLICE mode must NOT route the PRD.
			integration: {slice: 'propose', prd: 'merge'},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('prd');
		// MERGE: the PRD landed on arbiter main under work/prd/.
		expect(
			existsOnArbiterMain(repo, 'backlog', 'quiet-and-verbose-modes'),
		).toBe(false);
		gitIn(['fetch', '-q', ARBITER], repo);
		const prdOnMain = gitIn(
			['cat-file', '-e', `${ARBITER}/main:work/prd/quiet-and-verbose-modes.md`],
			repo,
		);
		// `cat-file -e` exits 0 (no output) when the blob exists.
		expect(prdOnMain).toBe('');
	});

	it('ask/bounce IGNORE the modes (no integrate happens regardless of the flags)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider({issue: {number: 9}});
		// Even with merge modes set, an ask emits NOTHING — no work branch, no main
		// touch — because ask/bounce never integrate (the modes are no-ops for them).
		const result = await performIntake({
			issueNumber: 9,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => ({outcome: 'ask', question: 'clarify?'}),
			integration: {slice: 'merge', prd: 'merge'},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('asked');
		expect(result.emitted).toBeUndefined();
		// No work branch pushed, main untouched (the merge mode did NOT integrate).
		expect(existsOnArbiterMain(repo, 'backlog', 'add-quiet-flag')).toBe(false);
		gitIn(['fetch', '-q', ARBITER], repo);
		const remoteBranches = gitIn(['branch', '-r'], repo);
		expect(remoteBranches).not.toMatch(/arbiter\/work\//);
	});
});

// ---------------------------------------------------------------------------
// The GitHub issue ADAPTER — gh confined to the adapter (stubbed via ghBin)
// ---------------------------------------------------------------------------

/**
 * Write an executable `gh` STUB that dispatches on the subcommand: `issue view`
 * prints canned JSON (issue or comments), `issue comment` records + exits 0.
 * Records every invocation's args so the test can assert the exact `gh` calls —
 * the SAME injectable-`ghBin` mechanism the PR-provider tests use (no network).
 */
function writeGhIssueStub(opts: {exitCode?: number} = {}): {
	bin: string;
	argsFile: string;
} {
	const bin = join(scratch.root, 'gh-issue-stub.sh');
	const argsFile = join(scratch.root, 'gh-issue-args.txt');
	const exit = opts.exitCode ?? 0;
	const issueJson = JSON.stringify({
		number: 42,
		title: 'Add a --quiet flag',
		body: 'suppress notes',
		author: {login: 'octocat'},
		state: 'OPEN',
	});
	const commentsJson = JSON.stringify({
		comments: [
			{author: {login: 'maintainer'}, body: 'which notes exactly?'},
			{author: {login: 'octocat'}, body: 'the >> ones'},
		],
	});
	const labelsJson = JSON.stringify({
		labels: [{name: 'bug'}, {name: PROCESSING_LOCK_LABEL}],
	});
	const script = [
		'#!/usr/bin/env bash',
		`printf '%s\\n' "$@" >> ${JSON.stringify(argsFile)}`,
		`if [ ${exit} -ne 0 ]; then exit ${exit}; fi`,
		'# Dispatch on the subcommand: comment / edit just exit 0; a --json read prints',
		'# the matching canned JSON (comments, labels, or the issue fields).',
		'for a in "$@"; do',
		'  if [ "$a" = "comment" ]; then exit 0; fi',
		'  if [ "$a" = "edit" ]; then exit 0; fi',
		'  if [ "$a" = "close" ]; then exit 0; fi',
		'done',
		'case "$*" in',
		`  *labels*) printf '%s\\n' ${JSON.stringify(labelsJson)} ;;`,
		`  *comments*) printf '%s\\n' ${JSON.stringify(commentsJson)} ;;`,
		`  *--json*) printf '%s\\n' ${JSON.stringify(issueJson)} ;;`,
		'esac',
		'exit 0',
	].join('\n');
	writeFileSync(bin, script + '\n');
	chmodSync(bin, 0o755);
	return {bin, argsFile};
}

/**
 * A `gh` stub whose `issue edit` ALWAYS fails with the given stderr (exit 1) — used
 * to assert the adapter surfaces the REAL stderr (e.g. an HTTP 403) rather than a
 * hard-coded "unauthenticated" guess. `label create` (if reached) is NOT exercised
 * here because the stderr is NOT a `not found`.
 */
function writeGhFailingEditStub(stderr: string): {
	bin: string;
	argsFile: string;
} {
	const bin = join(scratch.root, 'gh-failing-edit.sh');
	const argsFile = join(scratch.root, 'gh-failing-edit-args.txt');
	const script = [
		'#!/usr/bin/env bash',
		`printf '%s\\n' "$@" >> ${JSON.stringify(argsFile)}`,
		'for a in "$@"; do',
		`  if [ "$a" = "edit" ]; then printf '%s\\n' ${JSON.stringify(stderr)} 1>&2; exit 1; fi`,
		'done',
		'exit 0',
	].join('\n');
	writeFileSync(bin, script + '\n');
	chmodSync(bin, 0o755);
	return {bin, argsFile};
}

/**
 * A `gh` stub whose `issue close` ALWAYS fails with the given stderr (exit 1) —
 * used to assert the adapter DEGRADES (no throw) and surfaces the REAL stderr
 * (e.g. an HTTP 403) rather than a hard-coded "unauthenticated" guess.
 */
function writeGhFailingCloseStub(stderr: string): {
	bin: string;
	argsFile: string;
} {
	const bin = join(scratch.root, 'gh-failing-close.sh');
	const argsFile = join(scratch.root, 'gh-failing-close-args.txt');
	const script = [
		'#!/usr/bin/env bash',
		`printf '%s\\n' "$@" >> ${JSON.stringify(argsFile)}`,
		'for a in "$@"; do',
		`  if [ "$a" = "close" ]; then printf '%s\\n' ${JSON.stringify(stderr)} 1>&2; exit 1; fi`,
		'done',
		'exit 0',
	].join('\n');
	writeFileSync(bin, script + '\n');
	chmodSync(bin, 0o755);
	return {bin, argsFile};
}

/**
 * A `gh` stub modelling a FRESH repo: the FIRST `issue edit --add-label` fails with
 * `'<label>' not found` (the label has never been created); `label create` succeeds;
 * the SECOND `issue edit --add-label` (the retry) succeeds. State is held in a
 * sentinel file so the two `issue edit` calls differ.
 */
function writeGhFreshRepoLabelStub(): {bin: string; argsFile: string} {
	const bin = join(scratch.root, 'gh-fresh-repo.sh');
	const argsFile = join(scratch.root, 'gh-fresh-repo-args.txt');
	const createdFlag = join(scratch.root, 'gh-fresh-repo-created');
	const script = [
		'#!/usr/bin/env bash',
		`printf '%s\\n' "$@" >> ${JSON.stringify(argsFile)}`,
		'sub=""',
		'for a in "$@"; do',
		'  if [ "$a" = "edit" ] || [ "$a" = "create" ]; then sub="$a"; fi',
		'done',
		`if [ "$sub" = "create" ]; then : > ${JSON.stringify(createdFlag)}; exit 0; fi`,
		`if [ "$sub" = "edit" ]; then`,
		`  if [ -f ${JSON.stringify(createdFlag)} ]; then exit 0; fi`,
		`  printf "'${PROCESSING_LOCK_LABEL}' not found\\n" 1>&2; exit 1;`,
		'fi',
		'exit 0',
	].join('\n');
	writeFileSync(bin, script + '\n');
	chmodSync(bin, 0o755);
	return {bin, argsFile};
}

/**
 * A `gh` stub modelling a fresh repo whose token CANNOT create labels: the FIRST
 * `issue edit --add-label` fails with `'<label>' not found` (the fresh-repo SYMPTOM),
 * and the subsequent `label create` fails with the given permission stderr (exit 1).
 * Used to assert `mutateLabel` surfaces the CREATE's REAL cause, NOT the stale
 * `'<label>' not found` add failure.
 */
function writeGhCreateForbiddenStub(stderr: string): {
	bin: string;
	argsFile: string;
} {
	const bin = join(scratch.root, 'gh-create-forbidden.sh');
	const argsFile = join(scratch.root, 'gh-create-forbidden-args.txt');
	const script = [
		'#!/usr/bin/env bash',
		`printf '%s\\n' "$@" >> ${JSON.stringify(argsFile)}`,
		'sub=""',
		'for a in "$@"; do',
		'  if [ "$a" = "edit" ] || [ "$a" = "create" ]; then sub="$a"; fi',
		'done',
		`if [ "$sub" = "create" ]; then printf '%s\\n' ${JSON.stringify(stderr)} 1>&2; exit 1; fi`,
		`if [ "$sub" = "edit" ]; then printf "'${PROCESSING_LOCK_LABEL}' not found\\n" 1>&2; exit 1; fi`,
		'exit 0',
	].join('\n');
	writeFileSync(bin, script + '\n');
	chmodSync(bin, 0o755);
	return {bin, argsFile};
}

/**
 * A `gh` stub whose `issue comment` ALWAYS fails with the given stderr (exit 1) —
 * used to assert `postIssueComment` DEGRADES (no throw) and surfaces the REAL
 * stderr rather than the hard-coded "unavailable or unauthenticated" guess.
 */
function writeGhFailingCommentStub(stderr: string): {
	bin: string;
	argsFile: string;
} {
	const bin = join(scratch.root, 'gh-failing-comment.sh');
	const argsFile = join(scratch.root, 'gh-failing-comment-args.txt');
	const script = [
		'#!/usr/bin/env bash',
		`printf '%s\\n' "$@" >> ${JSON.stringify(argsFile)}`,
		'for a in "$@"; do',
		`  if [ "$a" = "comment" ]; then printf '%s\\n' ${JSON.stringify(stderr)} 1>&2; exit 1; fi`,
		'done',
		'exit 0',
	].join('\n');
	writeFileSync(bin, script + '\n');
	chmodSync(bin, 0o755);
	return {bin, argsFile};
}

describe('GitHubIssueProvider — gh confined to the adapter (stubbed ghBin)', () => {
	it('getIssue shells out to `gh issue view <N> --json …` and parses the issue', async () => {
		const stub = writeGhIssueStub();
		const provider = new GitHubIssueProvider({ghBin: stub.bin});
		const issue = await provider.getIssue({cwd: scratch.root, issueNumber: 42});
		expect(issue.number).toBe(42);
		expect(issue.title).toBe('Add a --quiet flag');
		expect(issue.body).toBe('suppress notes');
		expect(issue.author).toBe('octocat');
		expect(issue.state).toBe('open'); // lower-cased
		const args = readFileSync(stub.argsFile, 'utf8');
		expect(args).toMatch(/^issue$/m);
		expect(args).toMatch(/^view$/m);
		expect(args).toMatch(/^42$/m);
		expect(args).toMatch(/^--json$/m);
		expect(args).not.toMatch(/force/);
	});

	it('listComments shells out to `gh issue view <N> --json comments` and parses the thread', async () => {
		const stub = writeGhIssueStub();
		const provider = new GitHubIssueProvider({ghBin: stub.bin});
		const comments = await provider.listComments({
			cwd: scratch.root,
			issueNumber: 42,
		});
		expect(comments).toHaveLength(2);
		expect(comments[0].author).toBe('maintainer');
		expect(comments[0].body).toBe('which notes exactly?');
		expect(comments[1].author).toBe('octocat');
	});

	it('postIssueComment shells out to `gh issue comment <N> --body <text>`', async () => {
		const stub = writeGhIssueStub();
		const provider = new GitHubIssueProvider({ghBin: stub.bin});
		const result = await provider.postIssueComment({
			cwd: scratch.root,
			issueNumber: 42,
			body: 'please clarify',
		});
		expect(result.posted).toBe(true);
		const args = readFileSync(stub.argsFile, 'utf8');
		expect(args).toMatch(/^issue$/m);
		expect(args).toMatch(/^comment$/m);
		expect(args).toMatch(/^42$/m);
		expect(args).toMatch(/^--body$/m);
		expect(args).toMatch(/^please clarify$/m);
	});

	it('getLabels shells out to `gh issue view <N> --json labels` and parses the names', async () => {
		const stub = writeGhIssueStub();
		const provider = new GitHubIssueProvider({ghBin: stub.bin});
		const result = await provider.getLabels({
			cwd: scratch.root,
			issueNumber: 42,
		});
		expect(result.supported).toBe(true);
		expect(result.labels).toContain('bug');
		expect(result.labels).toContain(PROCESSING_LOCK_LABEL);
		const args = readFileSync(stub.argsFile, 'utf8');
		expect(args).toMatch(/^issue$/m);
		expect(args).toMatch(/^view$/m);
		expect(args).toMatch(/^labels$/m);
		expect(args).not.toMatch(/force/);
	});

	it('addLabel shells out to `gh issue edit <N> --add-label <label>` (the lock acquire)', async () => {
		const stub = writeGhIssueStub();
		const provider = new GitHubIssueProvider({ghBin: stub.bin});
		const result = await provider.addLabel({
			cwd: scratch.root,
			issueNumber: 42,
			label: PROCESSING_LOCK_LABEL,
		});
		expect(result.applied).toBe(true);
		const args = readFileSync(stub.argsFile, 'utf8');
		expect(args).toMatch(/^issue$/m);
		expect(args).toMatch(/^edit$/m);
		expect(args).toMatch(/^42$/m);
		expect(args).toMatch(/^--add-label$/m);
		expect(args).toMatch(
			new RegExp(`^${PROCESSING_LOCK_LABEL.replace(':', ':')}$`, 'm'),
		);
		// The lock is a single label; the adapter NEVER --force-s anything.
		expect(args).not.toMatch(/force/);
	});

	it('removeLabel shells out to `gh issue edit <N> --remove-label <label>` (the lock release)', async () => {
		const stub = writeGhIssueStub();
		const provider = new GitHubIssueProvider({ghBin: stub.bin});
		const result = await provider.removeLabel({
			cwd: scratch.root,
			issueNumber: 42,
			label: PROCESSING_LOCK_LABEL,
		});
		expect(result.applied).toBe(true);
		const args = readFileSync(stub.argsFile, 'utf8');
		expect(args).toMatch(/^--remove-label$/m);
	});

	it('closeIssue shells out to `gh issue close <N> --comment <body> --reason "not planned"` in ONE atomic call', async () => {
		const stub = writeGhIssueStub();
		const provider = new GitHubIssueProvider({ghBin: stub.bin});
		const result = await provider.closeIssue({
			cwd: scratch.root,
			issueNumber: 42,
			comment: 'Unrelated — please file separate issues.',
			reason: 'not planned',
		});
		expect(result.closed).toBe(true);
		const args = readFileSync(stub.argsFile, 'utf8');
		// ONE atomic `gh issue close` carrying BOTH --comment and --reason (no separate
		// post-then-close).
		expect(args).toMatch(/^issue$/m);
		expect(args).toMatch(/^close$/m);
		expect(args).toMatch(/^42$/m);
		expect(args).toMatch(/^--comment$/m);
		expect(args).toMatch(/^Unrelated — please file separate issues\.$/m);
		expect(args).toMatch(/^--reason$/m);
		expect(args).toMatch(/^not planned$/m);
		// The adapter NEVER --force-s anything; and it does NOT post a separate comment.
		expect(args).not.toMatch(/force/);
		expect(args).not.toMatch(/^comment$/m); // `issue comment`, not `issue close`
	});

	it('closeIssue omits --comment / --reason when not supplied (a bare close)', async () => {
		const stub = writeGhIssueStub();
		const provider = new GitHubIssueProvider({ghBin: stub.bin});
		const result = await provider.closeIssue({
			cwd: scratch.root,
			issueNumber: 7,
		});
		expect(result.closed).toBe(true);
		const args = readFileSync(stub.argsFile, 'utf8');
		expect(args).toMatch(/^close$/m);
		expect(args).not.toMatch(/^--comment$/m);
		expect(args).not.toMatch(/^--reason$/m);
	});

	it('closeIssue DEGRADES (no throw) when gh exits non-zero — surfacing the REAL stderr, NOT a hard-coded auth guess', async () => {
		const stub = writeGhFailingCloseStub('HTTP 403: Resource not accessible');
		const provider = new GitHubIssueProvider({ghBin: stub.bin});
		const result = await provider.closeIssue({
			cwd: scratch.root,
			issueNumber: 40,
			comment: 'the bounce text',
			reason: 'not planned',
		});
		expect(result.closed).toBe(false);
		// The REAL gh stderr is surfaced (diagnosable), NOT the old hard-coded
		// "unavailable or unauthenticated" guess that postIssueComment carries.
		expect(result.reason).toMatch(/403/);
		expect(result.instruction).toMatch(/403/);
		expect(result.instruction).not.toMatch(/unavailable or unauthenticated/i);
		// The closing comment text is never lost on degrade.
		expect(result.instruction).toContain('the bounce text');
	});

	it('closeIssue DEGRADES (no throw) when the gh binary is missing — the real cause is surfaced', async () => {
		const provider = new GitHubIssueProvider({
			ghBin: join(scratch.root, 'no-such-gh'),
		});
		const result = await provider.closeIssue({
			cwd: scratch.root,
			issueNumber: 42,
			reason: 'not planned',
		});
		expect(result.closed).toBe(false);
		expect(result.reason).toBeTruthy();
		expect(result.reason).toMatch(/missing/i);
		expect(result.instruction).not.toMatch(/unauthenticated/i);
	});

	it('getLabels FAILS (outcome: failed, no throw) on a label-supporting provider when gh exits non-zero — NOT a silent degrade', async () => {
		const stub = writeGhIssueStub({exitCode: 1});
		const provider = new GitHubIssueProvider({ghBin: stub.bin});
		const result = await provider.getLabels({
			cwd: scratch.root,
			issueNumber: 42,
		});
		// GitHub HAS labels, so a failed read is `failed`, NOT `unsupported` — the lock
		// must NOT be guessed free (the caller fails rather than degrading).
		expect(result.outcome).toBe('failed');
		expect(result.supported).toBe(false);
		expect(result.labels).toEqual([]);
	});

	it('addLabel/removeLabel FAIL (outcome: failed, no throw) when gh is missing — the real cause is surfaced', async () => {
		const provider = new GitHubIssueProvider({
			ghBin: join(scratch.root, 'no-such-gh'),
		});
		const added = await provider.addLabel({
			cwd: scratch.root,
			issueNumber: 42,
			label: PROCESSING_LOCK_LABEL,
		});
		const removed = await provider.removeLabel({
			cwd: scratch.root,
			issueNumber: 42,
			label: PROCESSING_LOCK_LABEL,
		});
		expect(added.outcome).toBe('failed');
		expect(added.applied).toBe(false);
		expect(removed.outcome).toBe('failed');
		expect(removed.applied).toBe(false);
		// The real cause (binary missing) is surfaced, NOT a hard-coded auth guess.
		expect(added.instruction).not.toMatch(/unauthenticated/i);
		expect(added.reason).toBeTruthy();
	});

	it('addLabel surfaces the REAL gh stderr (the original bug: a `<label> not found` is NOT reported as "unauthenticated")', async () => {
		// A `gh` that fails for a reason OTHER than "not found" (so the create-on-first-use
		// retry does not fire) — e.g. a permissions error — must surface that real stderr.
		const stub = writeGhFailingEditStub('HTTP 403: Resource not accessible');
		const provider = new GitHubIssueProvider({ghBin: stub.bin});
		const result = await provider.addLabel({
			cwd: scratch.root,
			issueNumber: 40,
			label: PROCESSING_LOCK_LABEL,
		});
		expect(result.outcome).toBe('failed');
		expect(result.applied).toBe(false);
		// The ACTUAL gh stderr is surfaced (diagnosable) — NOT the old hard-coded guess.
		expect(result.reason).toMatch(/403/);
		expect(result.instruction).toMatch(/403/);
		expect(result.instruction).not.toMatch(/unavailable or unauthenticated/i);
	});

	it('addLabel CREATES the lock label on first use (fresh repo) when gh reports it `not found`, then retries the add', async () => {
		// A fresh repo: the FIRST `gh issue edit --add-label` fails with `'<label>' not
		// found`; the adapter must `gh label create` then RETRY the add (so the lock
		// works from the first run rather than failing).
		const stub = writeGhFreshRepoLabelStub();
		const provider = new GitHubIssueProvider({ghBin: stub.bin});
		const result = await provider.addLabel({
			cwd: scratch.root,
			issueNumber: 40,
			label: PROCESSING_LOCK_LABEL,
		});
		expect(result.outcome).toBe('applied');
		expect(result.applied).toBe(true);
		const args = readFileSync(stub.argsFile, 'utf8');
		// It created the label …
		expect(args).toMatch(/^label$/m);
		expect(args).toMatch(/^create$/m);
		// … and the add-label edit appears (the retry after create).
		expect(args).toMatch(/^--add-label$/m);
	});

	it('a read THROWS on a non-zero gh (intake cannot decide without the issue)', async () => {
		const stub = writeGhIssueStub({exitCode: 1});
		const provider = new GitHubIssueProvider({ghBin: stub.bin});
		await expect(
			provider.getIssue({cwd: scratch.root, issueNumber: 42}),
		).rejects.toThrow(/gh/);
	});

	it('postIssueComment DEGRADES (no throw) when gh exits non-zero — advisory', async () => {
		const stub = writeGhIssueStub({exitCode: 1});
		const provider = new GitHubIssueProvider({ghBin: stub.bin});
		const result = await provider.postIssueComment({
			cwd: scratch.root,
			issueNumber: 42,
			body: 'the question',
		});
		expect(result.posted).toBe(false);
		expect(result.instruction).toContain('the question'); // text never lost
	});

	it('postIssueComment surfaces the REAL gh stderr on a non-auth failure, NOT the hard-coded "unavailable or unauthenticated" guess', async () => {
		// A `gh issue comment` that fails for a reason OTHER than auth (e.g. a 403
		// permissions error / a deleted issue) must surface that real stderr — the
		// same misattribution removed from `mutateLabel`/`closeIssue`.
		const stub = writeGhFailingCommentStub('HTTP 403: Resource not accessible');
		const provider = new GitHubIssueProvider({ghBin: stub.bin});
		const result = await provider.postIssueComment({
			cwd: scratch.root,
			issueNumber: 40,
			body: 'please clarify',
		});
		expect(result.posted).toBe(false);
		// The ACTUAL gh stderr is surfaced (diagnosable) — NOT the old hard-coded guess.
		expect(result.instruction).toMatch(/403/);
		expect(result.instruction).not.toMatch(/unavailable or unauthenticated/i);
		// The comment text is never lost on degrade.
		expect(result.instruction).toContain('please clarify');
	});

	it("addLabel surfaces the CREATE's REAL cause on a permission-denied `gh label create` (fresh repo), NOT the stale `not found` add failure", async () => {
		// A fresh repo whose token cannot create labels: the add fails `'<label>' not
		// found` (the SYMPTOM), then `gh label create` fails with a permissions error.
		// The reported reason must be the CREATE's real stderr, NOT the `not found`.
		const stub = writeGhCreateForbiddenStub(
			'0xronan7 does not have the correct permissions to execute AddLabelsToLabelable',
		);
		const provider = new GitHubIssueProvider({ghBin: stub.bin});
		const result = await provider.addLabel({
			cwd: scratch.root,
			issueNumber: 40,
			label: PROCESSING_LOCK_LABEL,
		});
		expect(result.outcome).toBe('failed');
		expect(result.applied).toBe(false);
		// The CREATE's real cause is surfaced — NOT the stale fresh-repo `not found`.
		expect(result.reason).toMatch(/correct permissions/);
		expect(result.instruction).toMatch(/correct permissions/);
		expect(result.reason).not.toMatch(/not found/i);
		expect(result.instruction).not.toMatch(/not found/i);
		// It DID attempt the create (the retry path), proving the surfaced cause is the
		// create's, not the add's.
		const args = readFileSync(stub.argsFile, 'utf8');
		expect(args).toMatch(/^label$/m);
		expect(args).toMatch(/^create$/m);
	});

	it('a missing gh binary degrades the comment poster (no throw)', async () => {
		const provider = new GitHubIssueProvider({
			ghBin: join(scratch.root, 'no-such-gh'),
		});
		const result = await provider.postIssueComment({
			cwd: scratch.root,
			issueNumber: 42,
			body: 'q',
		});
		expect(result.posted).toBe(false);
	});

	it('the core never imports gh: intake stubs the seam entirely (no gh-args leak)', () => {
		// The dispatcher tests above inject `issueProvider` + `decide`, so no `gh`
		// stub is ever spawned by the core — only the ADAPTER tests spawn `gh`. Assert
		// no stray gh-args file leaks outside the scratch root.
		void mkdirSync;
		const stray = join(scratch.root, '..', 'gh-issue-args.txt');
		expect(existsSync(stray)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// The TRIAGE GATE + MARKER (`intake-self-awareness-resumption-tracking`): a
// deterministic pre-decision gate, built ENTIRELY on intake's own MARKER on the
// thread (no sidecar/cursor/bot-identity), that runs the prompt ONLY on genuine new
// human input. Asserted at the stubbed issue seam: postIssueComment records the
// MARKER (kind + seen=) on every comment intake posts; listComments seeds threads
// with ids/markers; the triage branches drive the dispatch (no-new-input /
// race-proceed / already-terminal / proceed). The prompt JUDGEMENT is not unit
// tested (only the triage + dispatch).
// ---------------------------------------------------------------------------
describe('intake <N> — the triage gate + marker (stubbed seams)', () => {
	const NS = `${brand.base}:intake`;

	it('stamps the MARKER (kind=ask + seen=<human ids read>) on a posted ASK comment', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// Two human comments in the thread (ids 11,12). The ask marker records seen=11,12.
		const issueProvider = stubIssueProvider({
			issue: {number: 9},
			comments: [
				{id: '11', author: 'octocat', body: 'first'},
				{id: '12', author: 'octocat', body: 'second'},
			],
		});
		const result = await performIntake({
			issueNumber: 9,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => ({outcome: 'ask', question: 'Which notes exactly?'}),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('asked');
		expect(issueProvider.comments).toHaveLength(1);
		const body = issueProvider.comments[0].body;
		// The human-readable text AND the hidden marker (kind + seen= delta) are present.
		expect(body).toContain('Which notes exactly?');
		expect(body).toContain(`<!-- ${NS} kind=ask seen=11,12 -->`);
		// The marker stores kind + seen only — NOT a terminal flag.
		expect(body).not.toContain('terminal=');
		const marker = parseIntakeMarker(body);
		expect(marker).toEqual({kind: 'ask', seen: ['11', '12']});
	});

	it('stamps kind=bounced (terminal — owned by the triage, NOT the marker) on a posted BOUNCE comment', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider({
			issue: {number: 11},
			comments: [{id: '20', author: 'octocat', body: 'unrelated stuff'}],
		});
		const result = await performIntake({
			issueNumber: 11,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => ({
				outcome: 'bounce',
				bounceMessage: 'Please file separate issues.',
			}),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('bounced');
		// The bounce CLOSES the issue atomically; the marker rides the CLOSING COMMENT
		// (not a separate postIssueComment).
		expect(issueProvider.comments).toHaveLength(0);
		expect(issueProvider.closes).toHaveLength(1);
		const body = issueProvider.closes[0].comment ?? '';
		expect(body).toContain(`<!-- ${NS} kind=bounced seen=20 -->`);
		expect(body).not.toContain('terminal');
	});

	it('TRIAGE no-new-input: intake has the last word + nothing unseen → SKIP (prompt does NOT run, nothing posted)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider({
			issue: {number: 9},
			comments: [
				{id: '1', author: 'octocat', body: 'a human comment'},
				// Intake's OWN ask comment is last and recorded seeing id 1.
				{
					id: 'm1',
					author: 'octocat',
					body: stampIntakeMarker('what exactly?', {kind: 'ask', seen: ['1']}),
				},
			],
		});
		let decided = false;
		const result = await performIntake({
			issueNumber: 9,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => {
				decided = true;
				return {outcome: 'ask', question: 'x'};
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('no-new-input');
		// The prompt did NOT run; nothing emitted/posted.
		expect(decided).toBe(false);
		expect(issueProvider.comments).toHaveLength(0);
		expect(result.emitted).toBeUndefined();
	});

	it('SELF-TRIGGER is a no-op: intake’s own freshly-posted comment never re-triggers (no-new-input)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// Re-run reads intake's own last comment — it must NOT count as a new turn.
		const issueProvider = stubIssueProvider({
			issue: {number: 9},
			comments: [
				{
					id: 'm1',
					author: 'octocat',
					body: stampIntakeMarker('Created slice foo', {
						kind: 'ask',
						seen: [],
					}),
				},
			],
		});
		let decided = false;
		const result = await performIntake({
			issueNumber: 9,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => {
				decided = true;
				return {outcome: 'ask', question: 'x'};
			},
			env: gitEnv(),
		});
		expect(result.outcome).toBe('no-new-input');
		expect(decided).toBe(false);
	});

	it('TRIAGE race-proceed: a human comment raced in unseen → PROCEED, prompt told it PRE-DATES intake’s turn', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// Intake read [1] then human 2 raced in BEFORE intake posted its marker.
		const issueProvider = stubIssueProvider({
			issue: {number: 9},
			comments: [
				{id: '1', author: 'octocat', body: 'first'},
				{id: '2', author: 'octocat', body: 'raced-in comment'},
				{
					id: 'm1',
					author: 'octocat',
					body: stampIntakeMarker('what exactly?', {kind: 'ask', seen: ['1']}),
				},
			],
		});
		let promptSeen = '';
		const result = await performIntake({
			issueNumber: 9,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async ({prompt}) => {
				promptSeen = prompt;
				return {outcome: 'ask', question: 'follow up'};
			},
			env: gitEnv(),
		});
		// The decision RAN (not skipped) and dispatched.
		expect(result.outcome).toBe('asked');
		// The prompt was flagged that 1 comment pre-dates intake's last turn.
		expect(promptSeen).toMatch(/PRE-DATE/i);
		expect(promptSeen).toMatch(/1 comment/);
	});

	it('TRIAGE deletion-enrichment: raced-in + a previously-seen comment deleted → prompt told N deleted; reassess', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// seenSet={1,2}; thread has human 1 (2 deleted) + a NEW unseen human 3.
		const issueProvider = stubIssueProvider({
			issue: {number: 9},
			comments: [
				{id: '1', author: 'octocat', body: 'first'},
				{id: '3', author: 'octocat', body: 'new comment'},
				{
					id: 'm1',
					author: 'octocat',
					body: stampIntakeMarker('q', {kind: 'ask', seen: ['1', '2']}),
				},
			],
		});
		let promptSeen = '';
		const result = await performIntake({
			issueNumber: 9,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async ({prompt}) => {
				promptSeen = prompt;
				return {outcome: 'ask', question: 'follow up'};
			},
			env: gitEnv(),
		});
		expect(result.outcome).toBe('asked');
		expect(promptSeen).toMatch(/PRE-DATE/i);
		// The deletion flag + count surfaces (1 deleted), telling the prompt to reassess.
		expect(promptSeen).toMatch(/1 previously-seen comment\(s\) were DELETED/);
		expect(promptSeen).toMatch(/reassess/i);
	});

	it('TRIAGE deletion-only (no unseen comment) → SKIP no-new-input (a bare deletion is not a wake trigger)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// seenSet={1,2}; human 2 deleted but NO new comment.
		const issueProvider = stubIssueProvider({
			issue: {number: 9},
			comments: [
				{id: '1', author: 'octocat', body: 'first'},
				{
					id: 'm1',
					author: 'octocat',
					body: stampIntakeMarker('q', {kind: 'ask', seen: ['1', '2']}),
				},
			],
		});
		let decided = false;
		const result = await performIntake({
			issueNumber: 9,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => {
				decided = true;
				return {outcome: 'ask', question: 'x'};
			},
			env: gitEnv(),
		});
		expect(result.outcome).toBe('no-new-input');
		expect(decided).toBe(false);
	});

	it('TRIAGE already-terminal: a human comment after a TERMINAL marker (bounced/created) → SKIP (decision does NOT run)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider({
			issue: {number: 11},
			comments: [
				{id: '1', author: 'octocat', body: 'unrelated asks'},
				{
					id: 'm1',
					author: 'octocat',
					body: stampIntakeMarker('please split', {
						kind: 'bounced',
						seen: ['1'],
					}),
				},
				{id: '2', author: 'octocat', body: 'a later human comment'},
			],
		});
		let decided = false;
		const result = await performIntake({
			issueNumber: 11,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => {
				decided = true;
				return SLICE_VERDICT;
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('already-terminal');
		expect(decided).toBe(false);
		expect(result.emitted).toBeUndefined();
		expect(issueProvider.comments).toHaveLength(0);
	});

	it('TRIAGE proceed: a human reply after an ASK marker (non-terminal) resumes — the decision runs and dispatches', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider({
			issue: {number: 42},
			comments: [
				{id: '1', author: 'octocat', body: 'I want a flag'},
				{
					id: 'm1',
					author: 'octocat',
					body: stampIntakeMarker('which flag?', {kind: 'ask', seen: ['1']}),
				},
				{id: '2', author: 'octocat', body: 'the --quiet one'},
			],
		});
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => SLICE_VERDICT,
			reviewSlice: convergingReviewGate,
			env: gitEnv(),
		});
		// The mid-ask loop RESUMES: ask is NON-terminal, so the decision runs + slices.
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('sliced');
		expect(result.emitted).toBe('work/backlog/add-quiet-flag.md');
	});
});

// ---------------------------------------------------------------------------
// The COMPLETION COMMENT on SUCCESSFUL outcomes
// (`intake-posts-completion-comment-on-slice-prd-outcomes`, PRD `issue-intake`):
// on a `sliced` / `prd` outcome intake posts ONE INFORMATIONAL comment back on the
// issue — `slice created` / `prd created`, NEVER "resolved"; it links the PR
// (propose) or the landed commit (merge), carries the FULL `created` marker (incl.
// `seen=`) so the triage SKIPS `already-terminal` on it, and DEGRADES (a missing
// `gh` never changes the success outcome). Asserted at the stubbed issue seam.
// ---------------------------------------------------------------------------
describe('intake <N> — the completion comment on slice/prd success', () => {
	const NS = `${brand.base}:intake`;

	it('a `sliced` outcome posts an informational `slice created` comment naming the slug (NOT “resolved”), with the PR link in propose + the FULL created marker (incl. seen=)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// One human comment (id 7) → the created marker records seen=7 (the per-run delta).
		const issueProvider = stubIssueProvider({
			issue: {number: 42},
			comments: [{id: '7', author: 'octocat', body: 'please add it'}],
		});
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => SLICE_VERDICT,
			reviewSlice: convergingReviewGate,
			// propose (default) → the comment links the PR
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(result.commented).toBe(true);
		expect(issueProvider.comments).toHaveLength(1);
		expect(issueProvider.comments[0].issueNumber).toBe(42);
		const body = issueProvider.comments[0].body;
		// CREATED wording + the slug, NOT “resolved/closed”.
		expect(body).toContain('Created slice `add-quiet-flag`');
		expect(body).not.toMatch(/resolved|closed/i);
		// The FULL created marker (incl. `seen=` delta), via the shared stamp helper.
		expect(body).toContain(
			`<!-- ${NS} kind=created slug=add-quiet-flag seen=7 -->`,
		);
		const marker = parseIntakeMarker(body);
		expect(marker).toEqual({
			kind: 'created',
			slug: 'add-quiet-flag',
			seen: ['7'],
		});
		// The issue was NOT closed (informational only — intake never closes here).
		expect(issueProvider.closes).toHaveLength(0);
		expect(result.closed).toBeUndefined();
	});

	it('a `prd` outcome posts a `PRD created` comment naming the slug, with NO PRD link beyond the slug', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider({issue: {number: 5}});
		const result = await performIntake({
			issueNumber: 5,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => ({
				outcome: 'prd',
				prdSlug: 'quiet-and-verbose-modes',
				prdTitle: 'Quiet and verbose modes',
			}),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('prd');
		expect(issueProvider.comments).toHaveLength(1);
		const body = issueProvider.comments[0].body;
		expect(body).toContain('Created PRD `quiet-and-verbose-modes`');
		expect(body).not.toMatch(/resolved|closed/i);
		expect(body).toContain(`kind=created slug=quiet-and-verbose-modes`);
		// No close, no state change.
		expect(issueProvider.closes).toHaveLength(0);
	});

	it('MERGE mode links the LANDED COMMIT (from IntegrateResult.commit), not a PR', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider({issue: {number: 42}});
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => SLICE_VERDICT,
			reviewSlice: convergingReviewGate,
			integration: {slice: 'merge', prd: 'propose'},
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		// The slice landed on main; the comment links that commit SHA.
		expect(existsOnArbiterMain(repo, 'backlog', 'add-quiet-flag')).toBe(true);
		gitIn(['fetch', '-q', ARBITER], repo);
		const landed = gitIn(['rev-parse', `${ARBITER}/main`], repo).trim();
		expect(issueProvider.comments).toHaveLength(1);
		const body = issueProvider.comments[0].body;
		expect(body).toContain('Created slice `add-quiet-flag`');
		// The MERGE variant links the landed commit (the new `commit` field), not a PR.
		expect(body).toContain(landed);
		expect(body).not.toMatch(/PR:/);
	});

	it('composeIntakeCompletionComment: PROPOSE links the PR `url`; MERGE links the `commit` (two distinct messages)', () => {
		// PROPOSE → the PR url is the link (the `commit` field is irrelevant here).
		const propose = composeIntakeCompletionComment({
			kind: 'slice',
			slug: 'add-quiet-flag',
			integration: {
				mode: 'propose',
				mergedToMain: false,
				pushedRef: 'work/intake-slice-add-quiet-flag',
				provider: 'github',
				requestOpened: true,
				url: 'https://github.com/o/r/pull/7',
			},
			seen: ['7'],
		});
		expect(propose).toContain('Created slice `add-quiet-flag`');
		expect(propose).toContain('https://github.com/o/r/pull/7');
		expect(propose).not.toMatch(/landed on `main`/);
		expect(propose).toContain(
			`<!-- ${NS} kind=created slug=add-quiet-flag seen=7 -->`,
		);
		expect(propose).not.toMatch(/resolved|closed/i);

		// MERGE → the landed commit SHA is the link (the new `commit` field).
		const merge = composeIntakeCompletionComment({
			kind: 'slice',
			slug: 'add-quiet-flag',
			integration: {
				mode: 'merge',
				mergedToMain: true,
				pushedRef: 'main',
				provider: 'none',
				requestOpened: false,
				commit: 'deadbeefcafe1234',
			},
			seen: ['7'],
		});
		expect(merge).toContain('Created slice `add-quiet-flag`');
		expect(merge).toContain('deadbeefcafe1234');
		expect(merge).not.toMatch(/pull\//);
		expect(merge).toContain(
			`<!-- ${NS} kind=created slug=add-quiet-flag seen=7 -->`,
		);

		// The two messages are DISTINCT (PR link vs commit link).
		expect(propose).not.toBe(merge);
	});

	it('NO completion comment is posted on locked / asked / bounced', async () => {
		// locked: a second run while the lock is held backs off — no comment.
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const lockedProvider = stubIssueProvider({
			labels: [PROCESSING_LOCK_LABEL],
		});
		const locked = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: lockedProvider,
			decide: async () => SLICE_VERDICT,
			reviewSlice: convergingReviewGate,
			env: gitEnv(),
		});
		expect(locked.outcome).toBe('locked');
		expect(lockedProvider.comments).toHaveLength(0);

		// asked: posts its OWN ask comment (not a `created` completion comment).
		const askProvider = stubIssueProvider({issue: {number: 9}});
		const asked = await performIntake({
			issueNumber: 9,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: askProvider,
			decide: async () => ({outcome: 'ask', question: 'clarify?'}),
			env: gitEnv(),
		});
		expect(asked.outcome).toBe('asked');
		expect(askProvider.comments).toHaveLength(1);
		// It is the ASK comment, NOT a `created` completion comment.
		expect(askProvider.comments[0].body).not.toContain('kind=created');

		// bounced: closes the issue (the bounce text rides the close), posts no
		// `created` completion comment.
		const bounceProvider = stubIssueProvider({issue: {number: 11}});
		const bounced = await performIntake({
			issueNumber: 11,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: bounceProvider,
			decide: async () => ({outcome: 'bounce', bounceMessage: 'split it'}),
			env: gitEnv(),
		});
		expect(bounced.outcome).toBe('bounced');
		expect(bounceProvider.comments).toHaveLength(0);
	});

	it('a completion-comment post DEGRADE (gh missing/unauth) does NOT change the success outcome', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const base = stubIssueProvider({issue: {number: 42}});
		const notes: string[] = [];
		// The post FAILS (advisory degrade) — the slice still succeeds.
		const issueProvider: IssueProvider = {
			...base,
			async postIssueComment(input) {
				base.comments.push(input);
				return {
					posted: false,
					instruction: '`gh` is unavailable; the comment was not posted.',
				};
			},
		};
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => SLICE_VERDICT,
			reviewSlice: convergingReviewGate,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		// The success outcome is UNCHANGED by the degrade.
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('sliced');
		expect(result.emitted).toBe('work/backlog/add-quiet-flag.md');
		// `commented` reflects the failed post (advisory), but the run still succeeded.
		expect(result.commented).toBe(false);
	});

	it('the completion comment carries the TERMINAL `created` marker → the triage SKIPS `already-terminal` on a thread carrying it (cannot re-trigger intake)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// 1) FIRST run: slice the issue + capture the posted completion comment (with its
		//    full `created` marker), exactly as it would land on the thread.
		const first = stubIssueProvider({
			issue: {number: 42},
			comments: [{id: '7', author: 'octocat', body: 'please add it'}],
		});
		const sliced = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: first,
			decide: async () => SLICE_VERDICT,
			reviewSlice: convergingReviewGate,
			env: gitEnv(),
		});
		expect(sliced.outcome).toBe('sliced');
		const completionBody = first.comments[0].body;

		// 2) SECOND run on a thread that now carries that completion comment (intake's own
		//    terminal `created` marker) followed by a later human comment. The triage must
		//    SKIP `already-terminal` — the completion comment cannot re-trigger intake. The
		//    triage runs BEFORE any git work, so reusing the same repo is fine (it skips).
		const second = stubIssueProvider({
			issue: {number: 42},
			comments: [
				{id: '7', author: 'octocat', body: 'please add it'},
				{id: 'm1', author: 'octocat', body: completionBody},
				{id: '8', author: 'octocat', body: 'a later human comment'},
			],
		});
		let decided = false;
		const rerun = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: second,
			decide: async () => {
				decided = true;
				return SLICE_VERDICT;
			},
			env: gitEnv(),
		});
		expect(rerun.outcome).toBe('already-terminal');
		expect(decided).toBe(false);
		expect(rerun.emitted).toBeUndefined();
	});
});
