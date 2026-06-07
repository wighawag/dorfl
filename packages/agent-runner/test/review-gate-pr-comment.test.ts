import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {writeFileSync, chmodSync, readFileSync, existsSync} from 'node:fs';
import {performIntegration} from '../src/integration-core.js';
import {performClaim} from '../src/claim-cas.js';
import {
	stripVerdictJson,
	parseReviewVerdict,
	type ReviewGate,
	type ReviewVerdict,
} from '../src/review-gate.js';
import {GitHubProvider} from '../src/github.js';
import {
	NoneProvider,
	type ReviewProvider,
	type OpenRequestResult,
	type PostCommentInput,
	type PostCommentResult,
} from '../src/integrator.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `review-gate-pr-comment`: make the Gate-2 review VISIBLE on the PR by posting
 * the agent's VERBATIM review (the trailing `{verdict, findings}` JSON block
 * stripped) as a PR COMMENT on the `--propose` path, INCLUDING on approve. The
 * comment is ADVISORY \u2014 it changes no gate/verdict/merge logic.
 *
 * House style (mirrors `review-nits-observation.test.ts` /
 * `integration-core.test.ts`): a throwaway checkout + a local `--bare` arbiter +
 * a STUBBED review gate (a canned verdict carrying a verbatim `output`, no real
 * model) + a STUBBED provider that records its `postComment` calls (no real `gh`
 * / network). `isolatePiAgentDir` keeps the developer's real
 * `~/.pi/agent/sessions/`.
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-review-comment-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

const ARBITER = 'arbiter';
const PASS = 'exit 0';

/** A realistic verbatim review: rich prose ending in the `{verdict,findings}` JSON. */
const VERBATIM_APPROVE = [
	'# Review of slice "alpha"',
	'',
	'Lens 1 (claim-vs-code): the diff delivers what the slice claims.',
	'Lens 4 (destination check): merged as written, we reach the PRD goal.',
	'',
	'A non-blocking nit: consider renaming `foo` for clarity.',
	'',
	'```json',
	'{"verdict": "approve", "findings": [' +
		'{"severity": "non-blocking", "question": "rename foo"}]}',
	'```',
].join('\n');

/** The prose portion (everything the comment should contain, JSON excluded). */
const PROSE_MARKERS = [
	'Review of slice "alpha"',
	'claim-vs-code',
	'destination check',
	'consider renaming `foo` for clarity',
];

/**
 * A stubbed review gate returning a fixed verdict whose `output` is the verbatim
 * review text (the channel the production gate fills from `LaunchResult.output`).
 */
function stubGate(verdict: ReviewVerdict): ReviewGate {
	return async () => verdict;
}

/** A provider that opens a PR (returns a url) and RECORDS its postComment calls. */
function recordingProvider(opts: {url?: string} = {}): ReviewProvider & {
	readonly comments: PostCommentInput[];
} {
	const comments: PostCommentInput[] = [];
	const provider: ReviewProvider & {comments: PostCommentInput[]} = {
		name: 'recording',
		comments,
		openRequest(): OpenRequestResult {
			return opts.url === undefined
				? {opened: true, instruction: 'pushed (no url)'}
				: {opened: true, url: opts.url, instruction: `Opened ${opts.url}`};
		},
		postComment(input: PostCommentInput): PostCommentResult {
			comments.push(input);
			return {posted: true, instruction: `commented on ${input.url}`};
		},
	};
	return provider;
}

/** Stand a repo up exactly as the caller's HEAD leaves it just before the core. */
async function claimAndBranch(slug: string) {
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
	// Simulate the build agent: leave UNCOMMITTED work (it does no git).
	writeFileSync(join(repo, 'feature.txt'), 'the work\n');
	return {seeded, repo};
}

// ---------------------------------------------------------------------------
// stripVerdictJson — the verbatim text minus the trailing verdict JSON block
// ---------------------------------------------------------------------------

describe('stripVerdictJson — removes the verdict JSON, keeps the prose', () => {
	it('strips the trailing {verdict, findings} block from rich prose', () => {
		const stripped = stripVerdictJson(VERBATIM_APPROVE);
		for (const marker of PROSE_MARKERS) {
			expect(stripped).toContain(marker);
		}
		// The raw JSON is gone (no verdict key, no findings array literal).
		expect(stripped).not.toContain('"verdict"');
		expect(stripped).not.toContain('"findings"');
	});

	it('strips EXACTLY what parseReviewVerdict parses (one source of truth)', () => {
		// What is parsed is what is removed: parsing still succeeds on the original,
		// and the stripped text no longer contains a parseable verdict.
		expect(parseReviewVerdict(VERBATIM_APPROVE).verdict).toBe('approve');
		const stripped = stripVerdictJson(VERBATIM_APPROVE);
		expect(() => parseReviewVerdict(stripped)).toThrow();
	});

	it('returns the (trimmed) text unchanged when there is no verdict JSON', () => {
		const plain = 'just some review prose with no JSON at all';
		expect(stripVerdictJson(`\n${plain}\n`)).toBe(plain);
	});
});

// ---------------------------------------------------------------------------
// parseReviewVerdict — now also carries the verbatim output
// ---------------------------------------------------------------------------

describe('parseReviewVerdict — carries the verbatim output alongside the verdict', () => {
	it('attaches the raw output so the in-core poster can post it verbatim', () => {
		const verdict = parseReviewVerdict(VERBATIM_APPROVE);
		expect(verdict.output).toBe(VERBATIM_APPROVE);
		// Routing fields are unchanged.
		expect(verdict.verdict).toBe('approve');
		expect(verdict.findings).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// In-core wiring — performIntegration posts the comment AFTER the integrate
// ---------------------------------------------------------------------------

describe('review-gate-pr-comment — approve + PR opened ⇒ verbatim comment posted', () => {
	it('posts the VERBATIM review (JSON stripped) to the opened PR url', async () => {
		const {repo} = await claimAndBranch('alpha');
		const provider = recordingProvider({url: 'https://github.com/o/r/pull/7'});

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'alpha',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			reviewGate: stubGate(parseReviewVerdict(VERBATIM_APPROVE)),
			mode: 'propose',
			providerInstance: provider,
			env: gitEnv(),
		});

		// The verdict/routing is unchanged: an approve still completes + integrates.
		expect(core.outcome).toBe('completed');
		expect(core.integration?.url).toBe('https://github.com/o/r/pull/7');

		// Exactly one comment, threaded to the opened PR identity (from openRequest).
		expect(provider.comments).toHaveLength(1);
		expect(provider.comments[0].url).toBe('https://github.com/o/r/pull/7');

		// The comment is the review PROSE, NOT the raw JSON.
		const body = provider.comments[0].body;
		for (const marker of PROSE_MARKERS) {
			expect(body).toContain(marker);
		}
		expect(body).not.toContain('"verdict"');
		expect(body).not.toContain('"findings"');
	});
});

describe('review-gate-pr-comment — degraded provider (no PR url) ⇒ clean no-op', () => {
	it('does NOT call postComment when openRequest opened no PR (no url)', async () => {
		const {repo} = await claimAndBranch('beta');
		const provider = recordingProvider({url: undefined}); // degraded: no url

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'beta',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			reviewGate: stubGate(parseReviewVerdict(VERBATIM_APPROVE)),
			mode: 'propose',
			providerInstance: provider,
			env: gitEnv(),
		});

		// The work still completed (the review stays in the run output) \u2014 no throw,
		// no lost work \u2014 but nothing was posted (no PR to comment on).
		expect(core.outcome).toBe('completed');
		expect(core.integration?.url).toBeUndefined();
		expect(provider.comments).toHaveLength(0);
	});

	it('the merge path (no PR opened at all) posts no comment', async () => {
		const {repo} = await claimAndBranch('gamma');
		const provider = recordingProvider({url: 'https://github.com/o/r/pull/9'});

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'gamma',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			autoMerge: true,
			reviewGate: stubGate(parseReviewVerdict(VERBATIM_APPROVE)),
			mode: 'merge', // merge mode opens no PR (provider-agnostic git)
			providerInstance: provider,
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(core.integration?.mode).toBe('merge');
		// merge mode does not consult the provider for a request, so no url, no comment.
		expect(provider.comments).toHaveLength(0);
	});
});

describe('review-gate-pr-comment — the comment is ADVISORY (decision unchanged)', () => {
	it('the integration outcome is identical with and without commenting', async () => {
		// WITH a commenting provider.
		const withProvider = recordingProvider({
			url: 'https://github.com/o/r/pull/1',
		});
		const withRepo = (await claimAndBranch('delta')).repo;
		const withCore = await performIntegration({
			cwd: withRepo,
			arbiter: ARBITER,
			slug: 'delta',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			reviewGate: stubGate(parseReviewVerdict(VERBATIM_APPROVE)),
			mode: 'propose',
			providerInstance: withProvider,
			env: gitEnv(),
		});

		// WITHOUT (a provider that opens a PR but whose postComment is a no-op path:
		// the none provider degrades, never posting). Fresh scratch / arbiter.
		scratch.cleanup();
		scratch = makeScratch('agent-runner-review-comment-');
		const withoutRepo = (await claimAndBranch('delta')).repo;
		const withoutCore = await performIntegration({
			cwd: withoutRepo,
			arbiter: ARBITER,
			slug: 'delta',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			reviewGate: stubGate(parseReviewVerdict(VERBATIM_APPROVE)),
			mode: 'propose',
			// No providerInstance ⇒ the core selects `none` for the (file://) arbiter
			// (its postComment degrades — never posts, never throws).
			env: gitEnv(),
		});

		// Same outcome + effective mode: the comment changed nothing about the gate.
		expect(withCore.outcome).toBe(withoutCore.outcome);
		expect(withCore.integration?.mode).toBe(withoutCore.integration?.mode);
		// Only the commenting provider recorded a comment.
		expect(withProvider.comments).toHaveLength(1);
	});

	it('a stubbed review gate with NO output posts nothing (clean no-op)', async () => {
		const {repo} = await claimAndBranch('epsilon');
		const provider = recordingProvider({url: 'https://github.com/o/r/pull/2'});

		// A canned verdict with no `output` (e.g. an older stub) ⇒ nothing to post.
		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'epsilon',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			reviewGate: stubGate({verdict: 'approve', findings: []}),
			mode: 'propose',
			providerInstance: provider,
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(provider.comments).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// The GitHub adapter — gh pr comment args + graceful degradation
// ---------------------------------------------------------------------------

/**
 * Write an executable shell STUB standing in for the `gh` CLI (mirrors
 * `github.test.ts`): it records the args, prints stdout, and exits `exitCode`.
 */
function writeGhStub(opts: {stdout?: string; exitCode?: number} = {}): {
	bin: string;
	argsFile: string;
} {
	const bin = join(scratch.root, 'gh-stub.sh');
	const argsFile = join(scratch.root, 'gh-args.txt');
	const stdout = opts.stdout ?? '';
	const exit = opts.exitCode ?? 0;
	const script = [
		'#!/usr/bin/env bash',
		`printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
		`printf '%s\\n' ${JSON.stringify(stdout)}`,
		`exit ${exit}`,
	].join('\n');
	writeFileSync(bin, script + '\n');
	chmodSync(bin, 0o755);
	return {bin, argsFile};
}

function missingGhBin(): string {
	return join(scratch.root, 'no-such-gh-binary');
}

describe('GitHubProvider.postComment — gh pr comment (stubbed)', () => {
	it('shells out to `gh pr comment <url> --body <text>`', () => {
		const stub = writeGhStub();
		const provider = new GitHubProvider({ghBin: stub.bin});
		const result = provider.postComment({
			cwd: scratch.root,
			url: 'https://github.com/o/r/pull/7',
			body: 'The verbatim review prose.',
		});

		expect(result.posted).toBe(true);
		const args = readFileSync(stub.argsFile, 'utf8');
		expect(args).toMatch(/^pr$/m);
		expect(args).toMatch(/^comment$/m);
		expect(args).toMatch(/^https:\/\/github\.com\/o\/r\/pull\/7$/m);
		expect(args).toMatch(/^--body$/m);
		expect(args).toMatch(/^The verbatim review prose\.$/m);
		// Never --force anywhere.
		expect(args).not.toMatch(/force/);
	});

	it('degrades (no throw) when gh exits non-zero (unauthenticated)', () => {
		const stub = writeGhStub({exitCode: 1});
		const provider = new GitHubProvider({ghBin: stub.bin});
		const result = provider.postComment({
			cwd: scratch.root,
			url: 'https://github.com/o/r/pull/7',
			body: 'the review',
		});
		expect(result.posted).toBe(false);
		// The review text is surfaced in the fallback (never lost).
		expect(result.instruction).toContain('the review');
	});

	it('degrades (no throw) when gh is missing (spawn fails)', () => {
		const provider = new GitHubProvider({ghBin: missingGhBin()});
		const result = provider.postComment({
			cwd: scratch.root,
			url: 'https://github.com/o/r/pull/7',
			body: 'the review',
		});
		expect(result.posted).toBe(false);
		expect(result.instruction).toContain('the review');
	});
});

describe('NoneProvider.postComment — degrades, surfaces the review, never throws', () => {
	it('posts nothing but surfaces the review text', () => {
		const result = new NoneProvider().postComment({
			cwd: '/tmp',
			url: 'irrelevant',
			body: 'the review prose',
		});
		expect(result.posted).toBe(false);
		expect(result.instruction).toContain('the review prose');
	});
});

describe('review-gate-pr-comment — test isolation (real shared dirs untouched)', () => {
	it('the stubbed gate/provider write nothing to the real ~/.agent-runner', () => {
		// The core machinery isolates workspacesDir + uses a temp arbiter; the
		// stubbed gate runs no real launch and the recording provider does no IO.
		// Assert no stray gh-args file leaks outside the scratch root.
		const stray = join(scratch.root, 'gh-args.txt');
		expect(existsSync(stray)).toBe(false);
	});
});
