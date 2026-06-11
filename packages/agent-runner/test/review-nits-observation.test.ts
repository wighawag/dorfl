import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, existsSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {performIntegration} from '../src/integration-core.js';
import {performClaim} from '../src/claim-cas.js';
import {runOnce, type AgentRunner} from '../src/run.js';
import {mergeConfig} from '../src/config.js';
import {scanRepoPaths} from '../src/scan.js';
import type {ReviewGate, ReviewVerdict} from '../src/review-gate.js';
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
 * `review-nits-observation`: on a review APPROVE that carries ≥1 NON-BLOCKING
 * finding, the RUNNER (the shared `performIntegration` core — `do` AND `run`)
 * writes ONE per-run observation
 * `work/observations/review-nits-<slug>-<date>.md` capturing that run's
 * non-blocking nits, BEFORE the done-move + atomic `git add -A`, so it is swept
 * into the SAME done-commit on every path. A zero-nit approve writes nothing; a
 * BLOCK is unchanged (needs-attention/, no nit-observation); the verdict/routing
 * is identical with and without the write.
 *
 * House style (mirrors `integration-core.test.ts` / `run-integration-core.test.ts`):
 * a throwaway checkout + a local `--bare` arbiter + a STUBBED review gate (a
 * canned verdict — NO real model). `isolatePiAgentDir` keeps the developer's real
 * `~/.pi/agent/sessions/`; all writes go to temp work trees / the scratch arbiter,
 * so the real `~/.agent-runner/` is untouched.
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-review-nits-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

const ARBITER = 'arbiter';
const PASS = 'exit 0';

/** A stubbed review gate returning a fixed verdict (no real model). */
function stubGate(verdict: ReviewVerdict): ReviewGate {
	return async () => verdict;
}

/** An approve carrying two non-blocking findings (the nits to capture). */
const APPROVE_WITH_NITS: ReviewVerdict = {
	verdict: 'approve',
	findings: [
		{
			severity: 'non-blocking',
			question: 'rename this helper for clarity',
			context: 'src/foo.ts:42',
		},
		{
			severity: 'non-blocking',
			question: 'consider a comment on the regex',
		},
	],
};
const APPROVE_NO_NITS: ReviewVerdict = {verdict: 'approve', findings: []};
/** An approve that mixes a blocking and a non-blocking finding (approve still). */
const APPROVE_MIXED: ReviewVerdict = {
	verdict: 'approve',
	findings: [
		{severity: 'non-blocking', question: 'a nit to keep'},
		{severity: 'blocking', question: 'a phantom blocking note on an approve'},
	],
};
const BLOCK_WITH_NITS: ReviewVerdict = {
	verdict: 'block',
	findings: [
		{severity: 'blocking', question: 'the diff does not reach the slice goal'},
		{severity: 'non-blocking', question: 'this nit must NOT be captured'},
	],
};

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

/** The observation files written for a slug (sorted, just the basenames). */
function nitObservations(repo: string, slug: string): string[] {
	const dir = join(repo, 'work', 'observations');
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir)
		.filter((f) => f.startsWith(`review-nits-${slug}-`))
		.sort();
}

describe('review-nits-observation — approve WITH non-blocking findings (the core)', () => {
	it('writes ONE correctly-named observation with all the run\u2019s non-blocking findings', async () => {
		const {repo} = await claimAndBranch('alpha');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'alpha',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			reviewGate: stubGate(APPROVE_WITH_NITS),
			mode: 'propose',
			env: gitEnv(),
		});

		// The verdict/routing is unchanged: an approve still completes + integrates.
		expect(core.outcome).toBe('completed');
		expect(core.routedToNeedsAttention).toBe(false);

		// Exactly ONE observation, dated, content-derived name.
		const files = nitObservations(repo, 'alpha');
		expect(files).toHaveLength(1);
		expect(files[0]).toMatch(/^review-nits-alpha-\d{4}-\d{2}-\d{2}\.md$/);

		// Content: observations-convention frontmatter + a slug pointer + both nits.
		const body = readFileSync(
			join(repo, 'work', 'observations', files[0]),
			'utf8',
		);
		expect(body).toMatch(/^---\n/);
		expect(body).toMatch(/^title:.*alpha/m);
		expect(body).toMatch(/^date: \d{4}-\d{2}-\d{2}$/m);
		expect(body).toMatch(/^status: open$/m);
		expect(body).toMatch(/^slug: alpha$/m);
		expect(body).toContain('rename this helper for clarity');
		expect(body).toContain('src/foo.ts:42');
		expect(body).toContain('consider a comment on the regex');
		// The triage note is SKILL-AGNOSTIC: action-only wording that names no skill,
		// so the gate cannot keep a retired triage skill (batch-qa) alive on disk.
		expect(body).toContain(
			'is their durable home for triage — promote-to-slice / keep / delete.',
		);
		expect(body).not.toContain('batch-qa');
	});

	it('captures ONLY non-blocking findings even when the approve carries a blocking one', async () => {
		const {repo} = await claimAndBranch('mixed');

		await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'mixed',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			reviewGate: stubGate(APPROVE_MIXED),
			mode: 'propose',
			env: gitEnv(),
		});

		const files = nitObservations(repo, 'mixed');
		expect(files).toHaveLength(1);
		const body = readFileSync(
			join(repo, 'work', 'observations', files[0]),
			'utf8',
		);
		expect(body).toContain('a nit to keep');
		// The blocking finding is NOT in the nits observation (it is not a nit).
		expect(body).not.toContain('a phantom blocking note on an approve');
	});

	it('the observation is COMMITTED into the same done-commit (clean tree after the core)', async () => {
		const {repo} = await claimAndBranch('beta');

		await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'beta',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			reviewGate: stubGate(APPROVE_WITH_NITS),
			mode: 'propose',
			env: gitEnv(),
		});

		// The observation exists on disk…
		const files = nitObservations(repo, 'beta');
		expect(files).toHaveLength(1);
		// …and is NOT dangling: the atomic `git add -A` done-commit swept it in, so
		// the working tree is clean (no untracked/modified observation left over).
		const status = gitIn(['status', '--porcelain'], repo).trim();
		expect(status).toBe('');
		// It is tracked at the done-commit (HEAD), in the same commit as the move.
		const tracked = gitIn(
			['ls-files', `work/observations/${files[0]}`],
			repo,
		).trim();
		expect(tracked).toBe(`work/observations/${files[0]}`);
	});
});

describe('review-nits-observation — no observation when there is nothing to capture', () => {
	it('an approve with ZERO non-blocking findings writes NO observation', async () => {
		const {repo} = await claimAndBranch('gamma');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'gamma',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			reviewGate: stubGate(APPROVE_NO_NITS),
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(nitObservations(repo, 'gamma')).toHaveLength(0);
		// No observations/ dir spam at all (the write is the only thing that makes it).
		expect(existsSync(join(repo, 'work', 'observations'))).toBe(false);
	});

	it('a BLOCK writes NO review-nits observation (findings go to needs-attention, unchanged)', async () => {
		const {repo} = await claimAndBranch('delta');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'delta',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			reviewGate: stubGate(BLOCK_WITH_NITS),
			mode: 'propose',
			env: gitEnv(),
		});

		// The BLOCK path is unchanged: routed to needs-attention, never integrated.
		expect(core.outcome).toBe('review-blocked');
		expect(core.routedToNeedsAttention).toBe(true);
		expect(nitObservations(repo, 'delta')).toHaveLength(0);
		// The blocking finding still lands in the needs-attention body (unchanged).
		const dest = join(repo, 'work', 'needs-attention', 'delta.md');
		expect(existsSync(dest)).toBe(true);
		expect(readFileSync(dest, 'utf8')).toMatch(/does not reach the slice goal/);
	});
});

describe('review-nits-observation — the verdict/decision is identical with and without the write', () => {
	it('a zero-nit approve and a with-nits approve reach the SAME integration outcome', async () => {
		const without = await claimAndBranch('eta');
		const withoutCore = await performIntegration({
			cwd: without.repo,
			arbiter: ARBITER,
			slug: 'eta',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			autoMerge: true,
			reviewGate: stubGate(APPROVE_NO_NITS),
			mode: 'merge',
			env: gitEnv(),
		});

		// Fresh scratch for the with-nits run (independent arbiter).
		scratch.cleanup();
		scratch = makeScratch('agent-runner-review-nits-');
		const withNits = await claimAndBranch('eta');
		const withCore = await performIntegration({
			cwd: withNits.repo,
			arbiter: ARBITER,
			slug: 'eta',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			autoMerge: true,
			reviewGate: stubGate(APPROVE_WITH_NITS),
			mode: 'merge',
			env: gitEnv(),
		});

		// The decision is post-decision capture only: same outcome + effective mode.
		expect(withCore.outcome).toBe(withoutCore.outcome);
		expect(withCore.integration?.mode).toBe(withoutCore.integration?.mode);
		expect(withCore.integration?.mergedToMain).toBe(
			withoutCore.integration?.mergedToMain,
		);
		// But ONLY the with-nits run wrote an observation.
		expect(nitObservations(without.repo, 'eta')).toHaveLength(0);
		expect(nitObservations(withNits.repo, 'eta')).toHaveLength(1);
	});
});

describe('review-nits-observation — the MERGE path (no PR) still lands the observation', () => {
	it('an approve-with-nits on --merge writes the observation AND it reaches main', async () => {
		const {repo} = await claimAndBranch('zeta');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'zeta',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			autoMerge: true,
			reviewGate: stubGate(APPROVE_WITH_NITS),
			mode: 'merge',
			env: gitEnv(),
		});

		// merge proceeded (autoMerge on, approve) — no PR involved.
		expect(core.outcome).toBe('completed');
		expect(core.integration?.mode).toBe('merge');
		expect(core.integration?.mergedToMain).toBe(true);

		// The observation was written locally…
		const files = nitObservations(repo, 'zeta');
		expect(files).toHaveLength(1);
		// …and, since it was swept into the merged done-commit, it is on main too
		// (the --merge coverage the PR comment cannot give).
		expect(existsOnArbiterMain(repo, 'done', 'zeta')).toBe(true);
		expect(
			gitIn(
				['cat-file', '-e', `${ARBITER}/main:work/observations/${files[0]}`],
				repo,
			),
		).toBe('');
	});
});

/** A stubbed agent that edits a file (non-empty commit) and succeeds. */
const editingAgent: AgentRunner = ({cwd}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
	return {ok: true};
};

describe('review-nits-observation — the fleet (`run`) path also writes it', () => {
	function scanProject(config: Parameters<typeof scanRepoPaths>[1]) {
		return scanRepoPaths([join(scratch.root, 'project')], config);
	}
	function configFor(overrides = {}) {
		return mergeConfig({
			defaultArbiter: 'arbiter',
			maxParallel: 4,
			perRepoMax: 2,
			integration: 'merge',
			agentCmd: 'true',
			verify: PASS,
			allowAgents: true,
			...overrides,
		});
	}

	it('a `run` approve-with-nits writes the per-run observation to main (shared core)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor({review: true, autoMerge: true});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			reviewGate: stubGate(APPROVE_WITH_NITS),
			env: gitEnv(),
		});

		// The item integrated normally (the verdict/routing is unchanged)…
		expect(result.items[0].status).toBe('claimed-done');
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(true);

		// …and the fleet (sharing `performIntegration`) wrote the per-run nits
		// observation, swept into the same done-commit ⇒ it landed on main.
		gitIn(['fetch', '-q', ARBITER], repo);
		const onMain = gitIn(
			['ls-tree', '--name-only', `${ARBITER}/main`, 'work/observations/'],
			repo,
		)
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => /review-nits-feat-\d{4}-\d{2}-\d{2}\.md$/.test(l));
		expect(onMain).toHaveLength(1);
	});
});
