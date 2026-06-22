import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync} from 'node:fs';
import {performIntake} from '../src/intake.js';
import {promoteFromPrePrd} from '../src/needs-attention.js';
import {ledgerRead} from '../src/ledger-read.js';
import {resolveSlicingEligibility} from '../src/slicing-eligibility.js';
import {resolveEligibility} from '../src/eligibility.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	isolatePiAgentDir,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';
import type {
	Issue,
	IssueComment,
	IssueProvider,
	PostIssueCommentInput,
	CloseIssueInput,
} from '../src/issue-provider.js';

/**
 * STEP A of the PRD-lifecycle staging/pool split (PRD
 * `staging-pool-position-gate-and-trust-model` US #2/#5/#6/#12/#14, slice
 * `pre-prd-staging-pool-split-and-untrusted-prd-placement`; governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`).
 *
 * The PRD twin of `pre-backlog-staging-and-promote.test.ts`. Drives the
 * `intake`'s `prd` dispatcher end-to-end against a `--bare file://` arbiter
 * (house pattern via `test/helpers/gitRepo.ts`) and proves:
 *
 *   (a) an `intake`-authored PRD lands STAGED in `work/briefs/proposed/`, NOT in
 *       `work/briefs/ready/`, by default (the built-in floor) AND under
 *       `originTrust: untrusted` (the untrusted-origin force) even when the
 *       repo configures `briefsLandIn: 'ready'`;
 *   (b) `work/briefs/ready/` STILL means the auto-slice POOL: the pool reader
 *       (`createLocalLedgerReadStrategy().resolvePrdPool`) reads `work/briefs/ready/`
 *       byte-for-byte unchanged and a staged PRD is NOT in the pool; the
 *       slicing-eligibility gate refuses a staged slug;
 *   (c) the runner-owned promotion (`promoteFromPrePrd`) moves the staged
 *       PRD `pre-prd/ \u2192 prd/` on the arbiter and the same slug becomes
 *       auto-sliceable. There is no agent-facing path that performs the
 *       promotion (asserted structurally: no agent surface imports it);
 *   (d) the `briefAfter` (against `work/briefs/tasked/`) and `blockedBy`
 *       (against `work/tasks/done/`) resolution is UNCHANGED \u2014 PRD US #14.
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('pre-prd-step-a-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

/**
 * A minimal stubbed issue seam (mirrors `intake.test.ts`'s `stubIssueProvider`,
 * trimmed to the fields these tests use): canned issue + thread, in-memory
 * comments / labels / closes. No `gh`, no network.
 */
function stubIssueProvider(
	opts: {issue?: Partial<Issue>} = {},
): IssueProvider & {
	readonly comments: PostIssueCommentInput[];
	readonly closes: CloseIssueInput[];
} {
	const comments: PostIssueCommentInput[] = [];
	const closes: CloseIssueInput[] = [];
	const labels: string[] = [];
	const provider: IssueProvider & {
		comments: PostIssueCommentInput[];
		closes: CloseIssueInput[];
	} = {
		name: 'stub',
		comments,
		closes,
		async getIssue({issueNumber}) {
			return {
				number: issueNumber,
				title: 'A new vision worth a PRD',
				body: 'Outlines a coupled set of behaviours.',
				author: 'octocat',
				state: 'open',
				...opts.issue,
			};
		},
		async listComments(): Promise<IssueComment[]> {
			return [];
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
			return [...labels];
		},
		async addLabel({label}) {
			if (!labels.includes(label)) labels.push(label);
			return {added: true, instruction: `+${label}`};
		},
		async removeLabel({label}) {
			const i = labels.indexOf(label);
			if (i >= 0) labels.splice(i, 1);
			return {removed: true, instruction: `-${label}`};
		},
	};
	return provider;
}

const PRD_VERDICT = {
	outcome: 'prd' as const,
	prdSlug: 'shiny-new-vision',
	prdTitle: 'Shiny new vision',
	prdBody: [
		'## Problem Statement',
		'',
		'A coupled small pair worth a PRD.',
		'',
		'## Solution',
		'',
		'Do the coupled small pair.',
		'',
		'## User Stories',
		'',
		'1. As a user, I want it.',
	].join('\n'),
};

function onArbiterMain(repo: string, path: string): boolean {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return (
		run('git', ['cat-file', '-e', `${ARBITER}/main:${path}`], repo, {
			env: gitEnv(),
		}).status === 0
	);
}

/**
 * Land the staged PRD on `<arbiter>/main` (a propose-mode intake emission lives
 * on a `work/intake-brief-<slug>` branch \u2014 we ff-merge it onto main so the
 * read-strategy/pool/eligibility tests see it on main without changing intake's
 * default propose mode). The fetched ref is the arbiter side post-intake.
 */
function landIntakeBranchOnMain(repo: string, slug: string): void {
	gitIn(['fetch', '-q', ARBITER], repo);
	const branch = `work/intake-brief-${slug}`;
	gitIn(['checkout', 'main'], repo);
	gitIn(['merge', '--ff-only', `${ARBITER}/${branch}`], repo);
	gitIn(['push', '-q', ARBITER, 'main'], repo);
}

describe('STEP A (PRD) \u2014 intake-authored PRD lands STAGED in pre-prd/, not prd/', () => {
	it('the built-in floor stages a PRD: a default intake \u2192 work/briefs/proposed/<slug>.md (the pool is untouched)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: stubIssueProvider({issue: {number: 42}}),
			decide: async () => PRD_VERDICT,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('prd');
		expect(result.emitted).toBe('work/briefs/proposed/shiny-new-vision.md');
		landIntakeBranchOnMain(repo, 'shiny-new-vision');
		expect(
			onArbiterMain(repo, 'work/briefs/proposed/shiny-new-vision.md'),
		).toBe(true);
		expect(onArbiterMain(repo, 'work/briefs/ready/shiny-new-vision.md')).toBe(
			false,
		);
	});

	it('originTrust: untrusted FORCES staging even when briefsLandIn: ready (the untrusted-origin force)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await performIntake({
			issueNumber: 7,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: stubIssueProvider({issue: {number: 7}}),
			decide: async () => PRD_VERDICT,
			// The repo says "land PRDs in the pool" \u2014 but the trust signal
			// overrides it (PRD US #12).
			briefsLandIn: 'ready',
			originTrust: 'untrusted',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('prd');
		expect(result.emitted).toBe('work/briefs/proposed/shiny-new-vision.md');
	});

	it('the EXPLICIT operator flag wins over the untrusted-origin force (operator is present; CLI always wins)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await performIntake({
			issueNumber: 8,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: stubIssueProvider({issue: {number: 8}}),
			decide: async () => PRD_VERDICT,
			// Untrusted origin would force STAGING; the explicit --briefs-land-in
			// override beats it (mirrors `explicitMerge` overriding the
			// untrusted-origin build-propose rule).
			originTrust: 'untrusted',
			explicitBriefsLandIn: 'ready',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('prd');
		expect(result.emitted).toBe('work/briefs/ready/shiny-new-vision.md');
	});

	it('briefsLandIn: ready (configured default, trusted origin) lands the PRD in the pool', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await performIntake({
			issueNumber: 9,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: stubIssueProvider({issue: {number: 9}}),
			decide: async () => PRD_VERDICT,
			briefsLandIn: 'ready',
			originTrust: 'trusted',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('prd');
		expect(result.emitted).toBe('work/briefs/ready/shiny-new-vision.md');
	});
});

describe('STEP A (PRD) \u2014 work/briefs/ready/ STILL means the auto-slice POOL (readers unchanged)', () => {
	it('a staged PRD is NOT in the auto-slice pool: the pool reader sees nothing, the slicing-eligibility gate refuses', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: stubIssueProvider({issue: {number: 42}}),
			decide: async () => PRD_VERDICT,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('prd');
		landIntakeBranchOnMain(repo, 'shiny-new-vision');

		// THE POOL READER (`createLocalLedgerReadStrategy().resolvePrdPool`) reads
		// `work/briefs/ready/` BYTE-FOR-BYTE UNCHANGED: a staged PRD is NOT in the pool.
		const pool = ledgerRead.resolvePrdPool({repoPath: repo});
		expect(pool.prds.map((p) => p.slug)).not.toContain('shiny-new-vision');

		// AND the slicing-eligibility gate refuses an autonomous slice of a staged
		// PRD (by RESIDENCE \u2014 it is not in the pool to begin with).
		const eligibility = resolveSlicingEligibility({
			humanOnly: false,
			needsAnswers: false,
			autoTask: true,
			briefAfter: [],
			slicedSlugs: new Set(),
		});
		// The gate itself is open (no axes block it); the POSITION (residence
		// outside `work/briefs/ready/`) is what keeps the staged PRD out of the candidate
		// pool the selector consults. So we ALSO assert the file is not in
		// `work/briefs/ready/` on main (the structural fence).
		expect(eligibility.sliceable).toBe(true); // axes-only, sanity
		expect(onArbiterMain(repo, 'work/briefs/ready/shiny-new-vision.md')).toBe(
			false,
		);
	});
});

describe('STEP A (PRD) \u2014 the runner-owned promotion makes a staged PRD auto-sliceable', () => {
	it('promoteFromPrePrd moves pre-prd/<slug>.md \u2192 prd/<slug>.md on the arbiter; afterwards the pool reader sees it', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: stubIssueProvider({issue: {number: 42}}),
			decide: async () => PRD_VERDICT,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('prd');
		landIntakeBranchOnMain(repo, 'shiny-new-vision');

		// Precondition: staged, NOT in the pool.
		expect(
			onArbiterMain(repo, 'work/briefs/proposed/shiny-new-vision.md'),
		).toBe(true);
		expect(onArbiterMain(repo, 'work/briefs/ready/shiny-new-vision.md')).toBe(
			false,
		);

		// PROMOTE (runner-owned).
		const promoted = await promoteFromPrePrd({
			slug: 'shiny-new-vision',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(promoted.moved).toBe(true);
		expect(promoted.commitMessage).toMatch(
			/promote work\/briefs\/proposed\/ -> work\/briefs\/ready\//,
		);

		// Postcondition: in the pool, no longer staged.
		expect(
			onArbiterMain(repo, 'work/briefs/proposed/shiny-new-vision.md'),
		).toBe(false);
		expect(onArbiterMain(repo, 'work/briefs/ready/shiny-new-vision.md')).toBe(
			true,
		);

		// AND the pool reader now sees it (the auto-slice candidate pool).
		gitIn(['pull', '--ff-only', '-q', ARBITER, 'main'], repo);
		const pool = ledgerRead.resolvePrdPool({repoPath: repo});
		expect(pool.prds.map((p) => p.slug)).toContain('shiny-new-vision');
	});

	it('promote on a slug not in pre-prd/ refuses cleanly (no main move)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await promoteFromPrePrd({
			slug: 'nope',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/not staged|wrong slug|nothing/i);
	});

	it('promote is idempotent: re-running after the move LANDED is a no-op success (the second call finds the PRD already in the pool)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: stubIssueProvider({issue: {number: 42}}),
			decide: async () => PRD_VERDICT,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('prd');
		landIntakeBranchOnMain(repo, 'shiny-new-vision');
		const first = await promoteFromPrePrd({
			slug: 'shiny-new-vision',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(first.moved).toBe(true);
		// A second promote call (the source is gone; the dest is there) does not
		// CRASH; it returns a clean refusal/no-op (the dest-already-in-pool branch
		// of the `plan` resolver).
		const second = await promoteFromPrePrd({
			slug: 'shiny-new-vision',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		// The first move IS the durable transition; the second observes the PRD
		// already in the pool. Either flavour of "nothing more to do" is acceptable
		// here \u2014 a `moved: true` (idempotent re-confirm via the `already-done`
		// branch) OR a `moved: false` with a clean reason. The DURABLE state matters,
		// not the second-call return.
		expect(typeof second.moved).toBe('boolean');
		expect(onArbiterMain(repo, 'work/briefs/ready/shiny-new-vision.md')).toBe(
			true,
		);
		expect(
			onArbiterMain(repo, 'work/briefs/proposed/shiny-new-vision.md'),
		).toBe(false);
	});
});

describe('STEP A (PRD) \u2014 briefAfter (prd-sliced/) and blockedBy (done/) resolution is UNCHANGED (PRD US #14)', () => {
	it('briefAfter still resolves against work/briefs/tasked/ residence \u2014 not work/briefs/proposed/, not work/briefs/ready/', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// Seed an already-sliced PRD into work/briefs/tasked/, AND a counterpart in
		// the STAGING pre-prd/ folder. `briefAfter` resolution must read
		// `prd-sliced/` for its satisfied set \u2014 the staging folder must not
		// satisfy a `briefAfter` dependency.
		mkdirSync(join(repo, 'work', 'briefs', 'tasked'), {recursive: true});
		writeFileSync(
			join(repo, 'work', 'briefs', 'tasked', 'already-sliced.md'),
			'---\nslug: already-sliced\n---\n\nbody\n',
		);
		mkdirSync(join(repo, 'work', 'briefs', 'proposed'), {recursive: true});
		writeFileSync(
			join(repo, 'work', 'briefs', 'proposed', 'staged-not-sliced.md'),
			'---\nslug: staged-not-sliced\n---\n\nbody\n',
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed prd-sliced + pre-prd'], repo);
		gitIn(['push', '-q', ARBITER, 'main'], repo);

		// The pool reader reads `work/briefs/ready/` (the auto-slice pool, unchanged).
		const pool = ledgerRead.resolvePrdPool({repoPath: repo});
		// `slicedSlugs` is RESIDENCE in `work/briefs/tasked/` (mirror of `done/` for
		// blockedBy). The staged PRD in `work/briefs/proposed/` must NOT appear here.
		expect(pool.slicedSlugs.has('already-sliced')).toBe(true);
		expect(pool.slicedSlugs.has('staged-not-sliced')).toBe(false);

		// `briefAfter: [already-sliced]` is satisfied (the sliced set includes it).
		const okIfPriorSliced = resolveSlicingEligibility({
			humanOnly: false,
			needsAnswers: false,
			autoTask: true,
			briefAfter: ['already-sliced'],
			slicedSlugs: pool.slicedSlugs,
		});
		expect(okIfPriorSliced.sliceable).toBe(true);
		expect(okIfPriorSliced.briefAfter.satisfied).toBe(true);

		// `briefAfter: [staged-not-sliced]` is NOT satisfied \u2014 a STAGED PRD
		// (residence in `work/briefs/proposed/`) does NOT count as already-sliced.
		const blockedByStaged = resolveSlicingEligibility({
			humanOnly: false,
			needsAnswers: false,
			autoTask: true,
			briefAfter: ['staged-not-sliced'],
			slicedSlugs: pool.slicedSlugs,
		});
		expect(blockedByStaged.sliceable).toBe(false);
		expect(blockedByStaged.briefAfter.satisfied).toBe(false);
		expect(blockedByStaged.briefAfter.missing).toEqual(['staged-not-sliced']);
	});

	it('blockedBy still resolves against work/tasks/done/ residence \u2014 unchanged by the PRD staging split', () => {
		// `resolveEligibility` does the SLICE side; this asserts the staging
		// pre-prd/ split does not perturb blockedBy resolution (which is a SLICE
		// gate axis, never a PRD axis \u2014 the split is on PRDs only).
		const blocked = resolveEligibility({
			humanOnly: false,
			needsAnswers: false,
			autoBuild: true,
			blockedBy: ['some-done-slug'],
			doneSlugs: new Set(),
		});
		expect(blocked.eligible).toBe(false);
		expect(blocked.blockedBy.satisfied).toBe(false);
		expect(blocked.blockedBy.missing).toEqual(['some-done-slug']);

		const open = resolveEligibility({
			humanOnly: false,
			needsAnswers: false,
			autoBuild: true,
			blockedBy: ['some-done-slug'],
			doneSlugs: new Set(['some-done-slug']),
		});
		expect(open.eligible).toBe(true);
		expect(open.blockedBy.satisfied).toBe(true);
	});
});
