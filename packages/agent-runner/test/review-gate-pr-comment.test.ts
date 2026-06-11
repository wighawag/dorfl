import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {writeFileSync, chmodSync, readFileSync, existsSync} from 'node:fs';
import {performIntegration} from '../src/integration-core.js';
import {performClaim} from '../src/claim-cas.js';
import {
	parseReviewVerdict,
	buildReviewPrompt,
	type ReviewGate,
	type ReviewVerdict,
} from '../src/review-gate.js';
import {GitHubProvider} from '../src/github.js';
import {
	NoneProvider,
	type ReviewProvider,
	type OpenRequestResult,
	type PostPRCommentInput,
	type PostPRCommentOnBranchInput,
	type PostPRCommentResult,
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
 * `review-comment-prose-field` (refining `review-gate-pr-comment`): make the
 * Gate-2 review VISIBLE on the PR by posting the agent's DELIBERATELY-AUTHORED
 * `review` PROSE FIELD (carried INSIDE the single verdict JSON) as a PR COMMENT on
 * the `--propose` path, INCLUDING on approve. We post `verdict.review` \u2014 NOT the
 * agent's stream-of-consciousness around the JSON (that residue-posting was the
 * bug: `work/findings/review-comment-posts-agent-thinking-not-a-review.md`). The
 * comment is ADVISORY \u2014 it changes no gate/verdict/merge logic.
 *
 * House style (mirrors `review-nits-observation.test.ts` /
 * `integration-core.test.ts`): a throwaway checkout + a local `--bare` arbiter +
 * a STUBBED review gate (a canned verdict carrying a `review` field, no real
 * model) + a STUBBED provider that records its `postPRComment` calls (no real `gh`
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

/**
 * The deliberately-authored review prose the agent puts in the `review` FIELD: it
 * leads with Approved and gives the lenses + destination-check reasoning.
 */
const REVIEW_PROSE = [
	'Approved.',
	'',
	'Lens 1 (claim-vs-code): the diff delivers what the slice "alpha" claims.',
	'Lens 4 (destination check): merged as written, we reach the PRD goal.',
	'',
	'One non-blocking nit: consider renaming `foo` for clarity.',
].join('\n');

/**
 * The agent's casual STREAM-OF-CONSCIOUSNESS narration \u2014 what PR #20 wrongly
 * posted. The comment must NEVER contain this; it posts the `review` field, not the
 * surrounding final-message prose.
 */
const NARRATION = [
	'Let me check whether registering a CLI flag is in scope\u2026',
	'Let me confirm the consumers do not need changes\u2026',
	'All four lenses pass.',
].join('\n');

/** Markers that MUST appear in the posted comment (the authored review prose). */
const PROSE_MARKERS = [
	'Approved.',
	'claim-vs-code',
	'destination check',
	'consider renaming `foo` for clarity',
];

/** A realistic agent FINAL MESSAGE: casual narration AROUND a single JSON object
 * whose `review` field is the deliberately-authored review. `parseReviewVerdict`
 * reads the JSON (incl. the `review` field); the comment posts ONLY the field. */
const AGENT_OUTPUT_WITH_REVIEW_FIELD = [
	NARRATION,
	'',
	'```json',
	JSON.stringify({
		verdict: 'approve',
		review: REVIEW_PROSE,
		findings: [{severity: 'non-blocking', question: 'rename foo'}],
	}),
	'```',
].join('\n');

/** A stubbed review gate returning a fixed verdict. */
function stubGate(verdict: ReviewVerdict): ReviewGate {
	return async () => verdict;
}

/**
 * A provider that opens a PR and RECORDS its comment calls.
 *
 *  - `url` present ⇒ `openRequest` reports a parseable PR url (the normal path:
 *    the in-core poster comments via the url-keyed `postPRComment`).
 *  - `url` absent ⇒ `openRequest` reports `{opened: true}` with NO url (the
 *    `gh pr create` exit-0-but-unparseable-stdout degradation): the in-core
 *    poster must FALL BACK to the branch-resolved `postPRCommentOnBranch`.
 *  - `branchPrUrl` is what that branch-resolved fallback resolves: a url ⇒ a PR
 *    genuinely exists (it posts); `undefined` ⇒ NO PR resolvable (a clean no-op).
 */
function recordingProvider(
	opts: {url?: string; branchPrUrl?: string} = {},
): ReviewProvider & {
	readonly comments: PostPRCommentInput[];
	readonly branchComments: PostPRCommentOnBranchInput[];
} {
	const comments: PostPRCommentInput[] = [];
	const branchComments: PostPRCommentOnBranchInput[] = [];
	const provider: ReviewProvider & {
		comments: PostPRCommentInput[];
		branchComments: PostPRCommentOnBranchInput[];
	} = {
		name: 'recording',
		comments,
		branchComments,
		openRequest(): OpenRequestResult {
			return opts.url === undefined
				? {opened: true, instruction: 'pushed (no url)'}
				: {opened: true, url: opts.url, instruction: `Opened ${opts.url}`};
		},
		postPRComment(input: PostPRCommentInput): PostPRCommentResult {
			comments.push(input);
			return {posted: true, instruction: `commented on ${input.url}`};
		},
		postPRCommentOnBranch(
			input: PostPRCommentOnBranchInput,
		): PostPRCommentResult {
			branchComments.push(input);
			// Resolve the branch's PR from `branchPrUrl`: a url ⇒ posts; none ⇒ no-op.
			if (opts.branchPrUrl === undefined) {
				return {
					posted: false,
					instruction: `no PR resolvable for ${input.branch}`,
				};
			}
			return {
				posted: true,
				instruction: `commented on ${opts.branchPrUrl} (resolved from branch)`,
			};
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
	gitIn(['switch', '-q', '-c', `work/slice-${slug}`, `${ARBITER}/main`], repo);
	// Simulate the build agent: leave UNCOMMITTED work (it does no git).
	writeFileSync(join(repo, 'feature.txt'), 'the work\n');
	return {seeded, repo};
}

// ---------------------------------------------------------------------------
// buildReviewPrompt — requires a `review` prose field INSIDE the single JSON
// ---------------------------------------------------------------------------

describe('buildReviewPrompt — requires a `review` prose field in the JSON', () => {
	it('keeps the single-JSON contract AND demands a `review` field that leads with the verdict', () => {
		const p = buildReviewPrompt('alpha');
		// Still a single JSON object carrying verdict + findings (structure kept).
		expect(p).toMatch(/single JSON object/i);
		expect(p).toMatch(/"verdict"/);
		expect(p).toMatch(/"findings"/);
		// A `review` PROSE field is now required, posted as the PR comment.
		expect(p).toMatch(/"review"/);
		// It must lead with the verdict (Approved/Blocked) + the lenses /
		// destination-check reasoning, written for a human on the PR.
		expect(p).toMatch(/Approved|Blocked/);
		expect(p).toMatch(/lens|lenses/i);
		expect(p).toMatch(/destination check/i);
		// Guidance only: NO length limit, NO forced verbosity.
		expect(p).toMatch(/no length limit|NO length/i);
		expect(p).not.toMatch(/at least \d+ (words|sentences|paragraphs)/i);
		// It tells the agent NOT to narrate its process.
		expect(p).toMatch(/not.*narrate|do NOT narrate/i);
	});
});

// ---------------------------------------------------------------------------
// parseReviewVerdict — carries the authored `review` field (routing unchanged)
// ---------------------------------------------------------------------------

describe('parseReviewVerdict — carries the `review` field alongside the verdict', () => {
	it('reads the `review` prose field from the JSON; routing fields unchanged', () => {
		const verdict = parseReviewVerdict(AGENT_OUTPUT_WITH_REVIEW_FIELD);
		expect(verdict.review).toBe(REVIEW_PROSE);
		// Routing fields are unchanged.
		expect(verdict.verdict).toBe('approve');
		expect(verdict.findings).toHaveLength(1);
	});

	it('a verdict with no `review` field parses cleanly (review absent)', () => {
		const verdict = parseReviewVerdict(
			'{"verdict": "approve", "findings": []}',
		);
		expect(verdict.review).toBeUndefined();
		expect(verdict.verdict).toBe('approve');
	});

	it('a block carries its `review` prose too', () => {
		const verdict = parseReviewVerdict(
			JSON.stringify({
				verdict: 'block',
				review: 'Blocked. The diff drifts from the slice premise.',
				findings: [{severity: 'blocking', question: 'drift'}],
			}),
		);
		expect(verdict.verdict).toBe('block');
		expect(verdict.review).toBe(
			'Blocked. The diff drifts from the slice premise.',
		);
	});
});

// ---------------------------------------------------------------------------
// In-core wiring — performIntegration posts `verdict.review` after the integrate
// ---------------------------------------------------------------------------

describe('review-comment-prose-field — approve + PR opened ⇒ posts `verdict.review`', () => {
	it('posts the authored `review` prose (NOT the agent narration) to the PR url', async () => {
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
			// The gate parses the agent's final message: the `review` field is the
			// authored prose, the surrounding narration is ignored.
			reviewGate: stubGate(parseReviewVerdict(AGENT_OUTPUT_WITH_REVIEW_FIELD)),
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

		// The comment IS the authored `review` prose, verbatim.
		const body = provider.comments[0].body;
		expect(body).toBe(REVIEW_PROSE);
		for (const marker of PROSE_MARKERS) {
			expect(body).toContain(marker);
		}
		// And it is NOT the agent's stream-of-consciousness / raw final message.
		expect(body).not.toContain('Let me check');
		expect(body).not.toContain('Let me confirm');
		expect(body).not.toContain('All four lenses pass');
		// No raw JSON residue either.
		expect(body).not.toContain('"verdict"');
		expect(body).not.toContain('"findings"');
	});

	it('a gate carrying a `review` field directly (no parse) posts that field', async () => {
		const {repo} = await claimAndBranch('zeta');
		const provider = recordingProvider({url: 'https://github.com/o/r/pull/8'});

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'zeta',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			reviewGate: stubGate({
				verdict: 'approve',
				review: 'Approved. All lenses pass; destination reached.',
				findings: [],
			}),
			mode: 'propose',
			providerInstance: provider,
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(provider.comments).toHaveLength(1);
		expect(provider.comments[0].body).toBe(
			'Approved. All lenses pass; destination reached.',
		);
	});
});

describe('review-comment-fallback-on-unparsed-pr-url — PR opened but url unparseable', () => {
	it('FALLS BACK to the branch-resolved comment when a PR opened with no parseable url but one is resolvable', async () => {
		const {repo} = await claimAndBranch('beta');
		// openRequest opened a PR (exit 0) but its url was unparseable (url: undefined);
		// the branch DOES resolve to an open PR (branchPrUrl set).
		const provider = recordingProvider({
			url: undefined,
			branchPrUrl: 'https://github.com/o/r/pull/77',
		});

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'beta',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			reviewGate: stubGate(parseReviewVerdict(AGENT_OUTPUT_WITH_REVIEW_FIELD)),
			mode: 'propose',
			providerInstance: provider,
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		// No parseable url on the integration result (it degraded) ...
		expect(core.integration?.url).toBeUndefined();
		// ... so the review was posted via the BRANCH-resolved fallback, NOT dropped.
		expect(provider.comments).toHaveLength(0); // not the url path
		expect(provider.branchComments).toHaveLength(1);
		expect(provider.branchComments[0].branch).toBe('work/slice-beta');
		expect(provider.branchComments[0].body).toBe(REVIEW_PROSE);
	});

	it('clean no-op (no comment) when a PR opened with no parseable url AND none is resolvable from the branch', async () => {
		const {repo} = await claimAndBranch('beta2');
		// openRequest opened a PR (exit 0) but url unparseable, AND the branch resolves
		// to NO PR (branchPrUrl undefined) \u2014 the honest no-op, but only AFTER trying.
		const provider = recordingProvider({
			url: undefined,
			branchPrUrl: undefined,
		});

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'beta2',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			reviewGate: stubGate(parseReviewVerdict(AGENT_OUTPUT_WITH_REVIEW_FIELD)),
			mode: 'propose',
			providerInstance: provider,
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(core.integration?.url).toBeUndefined();
		// The fallback WAS tried (branch-keyed call made) ...
		expect(provider.branchComments).toHaveLength(1);
		// ... but resolved no PR, so nothing was posted on the url path either.
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
			reviewGate: stubGate(parseReviewVerdict(AGENT_OUTPUT_WITH_REVIEW_FIELD)),
			mode: 'merge', // merge mode opens no PR (provider-agnostic git)
			providerInstance: provider,
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(core.integration?.mode).toBe('merge');
		// merge mode does not consult the provider for a request, so no url, no comment
		// \u2014 and NO branch-resolved fallback either (no PR was opened at all).
		expect(provider.comments).toHaveLength(0);
		expect(provider.branchComments).toHaveLength(0);
	});
});

describe('review-comment-prose-field — the comment is ADVISORY (decision unchanged)', () => {
	it('the integration outcome is identical with the SAME GitHub provider, commenting ON vs OFF', async () => {
		// The control isolates COMMENTING: BOTH arms use the SAME provider type (a
		// `GitHubProvider` over a stubbed `gh`), so the only difference is whether a
		// comment is posted at all. Commenting is driven by the gate carrying a
		// `review` field — ON = a verdict WITH `review` (a comment posts), OFF = the
		// SAME approve verdict WITHOUT `review` (nothing to post). If the outcome /
		// effective mode match across the two, the comment changed no gate/verdict/
		// merge logic.

		// WITH commenting: a GitHubProvider whose stubbed `gh pr create` returns a
		// parseable url (so the url-keyed post fires) and records the `gh pr comment`.
		const onStub = writeGhStub({stdout: 'https://github.com/o/r/pull/1'});
		const onRepo = (await claimAndBranch('delta')).repo;
		const onCore = await performIntegration({
			cwd: onRepo,
			arbiter: ARBITER,
			slug: 'delta',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			reviewGate: stubGate(parseReviewVerdict(AGENT_OUTPUT_WITH_REVIEW_FIELD)),
			mode: 'propose',
			providerInstance: new GitHubProvider({ghBin: onStub.bin}),
			env: gitEnv(),
		});
		// The commenting arm actually shelled `gh pr comment` (capture BEFORE the
		// scratch is recycled for the OFF arm below).
		const onArgs = readFileSync(onStub.argsFile, 'utf8');

		// WITHOUT commenting: the SAME GitHubProvider type over a fresh stub, but the
		// approve verdict carries NO `review` field — so the core posts nothing.
		// Fresh scratch / arbiter.
		scratch.cleanup();
		scratch = makeScratch('agent-runner-review-comment-');
		const offStub = writeGhStub({stdout: 'https://github.com/o/r/pull/1'});
		const offRepo = (await claimAndBranch('delta')).repo;
		const offCore = await performIntegration({
			cwd: offRepo,
			arbiter: ARBITER,
			slug: 'delta',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			// SAME approve verdict, but with NO `review` field ⇒ commenting OFF.
			reviewGate: stubGate({verdict: 'approve', findings: []}),
			mode: 'propose',
			providerInstance: new GitHubProvider({ghBin: offStub.bin}),
			env: gitEnv(),
		});

		// Same outcome + effective mode: the comment changed nothing about the gate.
		expect(onCore.outcome).toBe(offCore.outcome);
		expect(onCore.integration?.mode).toBe(offCore.integration?.mode);
		expect(onCore.integration?.url).toBe(offCore.integration?.url);
		// The commenting arm shelled `gh pr comment`; the non-commenting arm's last
		// `gh` call was the `pr create`, NOT a comment.
		expect(onArgs).toMatch(/^comment$/m);
		expect(readFileSync(offStub.argsFile, 'utf8')).not.toMatch(/^comment$/m);
	});

	it('a stubbed review gate with NO `review` field posts nothing (clean no-op)', async () => {
		const {repo} = await claimAndBranch('epsilon');
		const provider = recordingProvider({url: 'https://github.com/o/r/pull/2'});

		// A canned verdict with no `review` ⇒ nothing to post (no residue fallback).
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
function writeGhStub(
	opts: {stdout?: string; stderr?: string; exitCode?: number} = {},
): {
	bin: string;
	argsFile: string;
} {
	const bin = join(scratch.root, 'gh-stub.sh');
	const argsFile = join(scratch.root, 'gh-args.txt');
	const stdout = opts.stdout ?? '';
	const stderr = opts.stderr ?? '';
	const exit = opts.exitCode ?? 0;
	const script = [
		'#!/usr/bin/env bash',
		`printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
		`printf '%s\\n' ${JSON.stringify(stdout)}`,
		`printf '%s\\n' ${JSON.stringify(stderr)} 1>&2`,
		`exit ${exit}`,
	].join('\n');
	writeFileSync(bin, script + '\n');
	chmodSync(bin, 0o755);
	return {bin, argsFile};
}

function missingGhBin(): string {
	return join(scratch.root, 'no-such-gh-binary');
}

/**
 * A RICHER `gh` stub that answers `pr view` and `pr comment` DIFFERENTLY (the
 * branch-resolved fallback resolves the PR url via `gh pr view <branch> --json
 * url --jq .url`, THEN comments via `gh pr comment <url>`):
 *   - `gh pr view …`    → prints `viewUrl` (empty + exit `viewExit` for "no PR");
 *   - `gh pr comment …` → records its args, exits 0.
 * Records the LAST `gh pr comment` invocation's args so a test can assert the
 * comment targeted the resolved url.
 */
function writeBranchResolveGhStub(opts: {
	viewUrl?: string;
	viewExit?: number;
}): {bin: string; commentArgsFile: string} {
	const bin = join(scratch.root, 'gh-branch-stub.sh');
	const commentArgsFile = join(scratch.root, 'gh-comment-args.txt');
	const viewUrl = opts.viewUrl ?? '';
	const viewExit = opts.viewExit ?? 0;
	const script = [
		'#!/usr/bin/env bash',
		'if [ "$1" = "pr" ] && [ "$2" = "view" ]; then',
		`  printf '%s\\n' ${JSON.stringify(viewUrl)}`,
		`  exit ${viewExit}`,
		'fi',
		'if [ "$1" = "pr" ] && [ "$2" = "comment" ]; then',
		`  printf '%s\\n' "$@" > ${JSON.stringify(commentArgsFile)}`,
		'  exit 0',
		'fi',
		'exit 0',
	].join('\n');
	writeFileSync(bin, script + '\n');
	chmodSync(bin, 0o755);
	return {bin, commentArgsFile};
}

describe('GitHubProvider.postPRComment — gh pr comment (stubbed)', () => {
	it('shells out to `gh pr comment <url> --body <text>`', () => {
		const stub = writeGhStub();
		const provider = new GitHubProvider({ghBin: stub.bin});
		const result = provider.postPRComment({
			cwd: scratch.root,
			url: 'https://github.com/o/r/pull/7',
			body: 'The authored review prose.',
		});

		expect(result.posted).toBe(true);
		const args = readFileSync(stub.argsFile, 'utf8');
		expect(args).toMatch(/^pr$/m);
		expect(args).toMatch(/^comment$/m);
		expect(args).toMatch(/^https:\/\/github\.com\/o\/r\/pull\/7$/m);
		expect(args).toMatch(/^--body$/m);
		expect(args).toMatch(/^The authored review prose\.$/m);
		// Never --force anywhere.
		expect(args).not.toMatch(/force/);
	});

	it('degrades (no throw) when gh exits non-zero (unauthenticated)', () => {
		const stub = writeGhStub({exitCode: 1});
		const provider = new GitHubProvider({ghBin: stub.bin});
		const result = provider.postPRComment({
			cwd: scratch.root,
			url: 'https://github.com/o/r/pull/7',
			body: 'the review',
		});
		expect(result.posted).toBe(false);
		// The review text is surfaced in the fallback (never lost).
		expect(result.instruction).toContain('the review');
	});

	it('surfaces the REAL gh stderr on a non-auth failure, NOT the hard-coded "unavailable or unauthenticated" guess', () => {
		// A rate-limit (NOT an auth problem): the operator must be told the truth.
		const realCause =
			'API rate limit exceeded for installation. Retry after 2026-06-11T12:00:00Z';
		const stub = writeGhStub({exitCode: 1, stderr: realCause});
		const provider = new GitHubProvider({ghBin: stub.bin});
		const result = provider.postPRComment({
			cwd: scratch.root,
			url: 'https://github.com/o/r/pull/7',
			body: 'the review',
		});
		expect(result.posted).toBe(false);
		// The REAL cause is surfaced verbatim, NOT misattributed to auth.
		expect(result.instruction).toContain(realCause);
		expect(result.instruction).not.toMatch(/unavailable or unauthenticated/);
		// The manual-fallback guidance + the review text are still intact.
		expect(result.instruction).toContain('https://github.com/o/r/pull/7');
		expect(result.instruction).toContain('the review');
	});

	it('reads as the clear "binary missing" string when gh is missing (spawn fails) — never crashes', () => {
		const provider = new GitHubProvider({ghBin: missingGhBin()});
		const result = provider.postPRComment({
			cwd: scratch.root,
			url: 'https://github.com/o/r/pull/7',
			body: 'the review',
		});
		expect(result.posted).toBe(false);
		expect(result.instruction).toContain('binary missing');
		expect(result.instruction).not.toMatch(/unavailable or unauthenticated/);
		// The review text is surfaced in the fallback (never lost).
		expect(result.instruction).toContain('the review');
	});
});

describe('GitHubProvider.postPRCommentOnBranch — branch-resolved fallback (stubbed)', () => {
	it('resolves the PR from the branch and POSTS the comment on it', () => {
		const stub = writeBranchResolveGhStub({
			viewUrl: 'https://github.com/o/r/pull/77',
		});
		const provider = new GitHubProvider({ghBin: stub.bin});
		const result = provider.postPRCommentOnBranch({
			cwd: scratch.root,
			branch: 'work/slice-feat',
			body: 'The authored review prose.',
		});

		expect(result.posted).toBe(true);
		// It commented on the URL it RESOLVED from the branch (not the branch directly).
		const args = readFileSync(stub.commentArgsFile, 'utf8');
		expect(args).toMatch(/^pr$/m);
		expect(args).toMatch(/^comment$/m);
		expect(args).toMatch(/^https:\/\/github\.com\/o\/r\/pull\/77$/m);
		expect(args).toMatch(/^--body$/m);
		expect(args).toMatch(/^The authored review prose\.$/m);
		expect(args).not.toMatch(/force/);
	});

	it('clean no-op (posts nothing) when NO PR resolves from the branch', () => {
		// `gh pr view` exits non-zero (no PR for the branch) — the honest no-op, but
		// only AFTER trying.
		const stub = writeBranchResolveGhStub({viewUrl: '', viewExit: 1});
		const provider = new GitHubProvider({ghBin: stub.bin});
		const result = provider.postPRCommentOnBranch({
			cwd: scratch.root,
			branch: 'work/slice-feat',
			body: 'the review',
		});

		expect(result.posted).toBe(false);
		// Nothing was posted (no `gh pr comment` invocation recorded) ...
		expect(existsSync(stub.commentArgsFile)).toBe(false);
		// ... and the review text is surfaced in the fallback (never lost).
		expect(result.instruction).toContain('the review');
	});

	it('degrades (no throw) when gh is missing (spawn fails)', () => {
		const provider = new GitHubProvider({ghBin: missingGhBin()});
		const result = provider.postPRCommentOnBranch({
			cwd: scratch.root,
			branch: 'work/slice-feat',
			body: 'the review',
		});
		expect(result.posted).toBe(false);
		expect(result.instruction).toContain('the review');
	});
});

describe('NoneProvider.postPRComment — degrades, surfaces the review, never throws', () => {
	it('posts nothing but surfaces the review text', () => {
		const result = new NoneProvider().postPRComment({
			cwd: '/tmp',
			url: 'irrelevant',
			body: 'the review prose',
		});
		expect(result.posted).toBe(false);
		expect(result.instruction).toContain('the review prose');
	});

	it('postPRCommentOnBranch posts nothing but surfaces the review text', () => {
		const result = new NoneProvider().postPRCommentOnBranch({
			cwd: '/tmp',
			branch: 'work/slice-feat',
			body: 'the review prose',
		});
		expect(result.posted).toBe(false);
		expect(result.instruction).toContain('the review prose');
	});
});

describe('review-comment-prose-field — test isolation (real shared dirs untouched)', () => {
	it('the stubbed gate/provider write nothing to the real ~/.agent-runner', () => {
		// The core machinery isolates workspacesDir + uses a temp arbiter; the
		// stubbed gate runs no real launch and the recording provider does no IO.
		// Assert no stray gh-args file leaks outside the scratch root.
		const stray = join(scratch.root, 'gh-args.txt');
		expect(existsSync(stray)).toBe(false);
	});
});
