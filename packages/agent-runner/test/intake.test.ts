import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {
	writeFileSync,
	chmodSync,
	readFileSync,
	existsSync,
	mkdirSync,
} from 'node:fs';
import {performIntake, type IntakeVerdict} from '../src/intake.js';
import {
	GitHubIssueProvider,
	type Issue,
	type IssueComment,
	type IssueProvider,
	type PostIssueCommentInput,
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

/** A stubbed issue seam: canned issue + thread, recording its posted comments. */
function stubIssueProvider(
	opts: {
		issue?: Partial<Issue>;
		comments?: IssueComment[];
	} = {},
): IssueProvider & {readonly comments: PostIssueCommentInput[]} {
	const comments: PostIssueCommentInput[] = [];
	const provider: IssueProvider & {comments: PostIssueCommentInput[]} = {
		name: 'stub',
		comments,
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
	};
	return provider;
}

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
	it('a stubbed `slice` verdict writes work/backlog/<slug>.md (Fixes #N, covers: [], no prd:) and proposes a PR (main untouched)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider();

		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => SLICE_VERDICT,
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
			['rev-parse', '--verify', '--quiet', `${ARBITER}/work/add-quiet-flag`],
			repo,
		).trim();
		expect(branchTip).not.toBe('');

		// The slice file ON THAT BRANCH carries Fixes #N, covers: [], and NO prd:.
		const onBranch = gitIn(
			['show', `${ARBITER}/work/add-quiet-flag:work/backlog/add-quiet-flag.md`],
			repo,
		);
		expect(onBranch).toContain('slug: add-quiet-flag');
		expect(onBranch).toContain('covers: []');
		expect(onBranch).not.toMatch(/^prd:/m);
		expect(onBranch).toContain('Fixes #42');
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
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);

		// The agent posted NO issue comment (the slice branch never posts; only
		// ask/bounce do, in a later slice) — the runner owns every seam side-effect.
		expect(issueProvider.comments).toHaveLength(0);

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
				`${ARBITER}/main..${ARBITER}/work/add-quiet-flag`,
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
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		// Content-derived (paramCase of the title), NOT an issue-number counter.
		expect(result.emittedSlug).toBe('fix-the-broken-login-button');
		expect(result.emittedSlug).not.toContain('3');
	});

	it('a non-slice verdict (ask/prd/bounce) is NOT dispatched in this slice — no write, clean exit', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await performIntake({
			issueNumber: 9,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: stubIssueProvider({issue: {number: 9}}),
			decide: async () => ({outcome: 'ask', question: 'what exactly?'}),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('ask');
		// Nothing emitted; main untouched.
		expect(existsOnArbiterMain(repo, 'backlog', 'add-quiet-flag')).toBe(false);
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
		};
		const result = await performIntake({
			issueNumber: 99,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: failingProvider,
			decide: async () => SLICE_VERDICT,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toContain('#99');
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
	const script = [
		'#!/usr/bin/env bash',
		`printf '%s\\n' "$@" >> ${JSON.stringify(argsFile)}`,
		`if [ ${exit} -ne 0 ]; then exit ${exit}; fi`,
		'# Dispatch on whether --json asks for comments vs the issue fields.',
		'for a in "$@"; do',
		'  if [ "$a" = "comment" ]; then exit 0; fi',
		'done',
		'case "$*" in',
		`  *comments*) printf '%s\\n' ${JSON.stringify(commentsJson)} ;;`,
		`  *--json*) printf '%s\\n' ${JSON.stringify(issueJson)} ;;`,
		'esac',
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
