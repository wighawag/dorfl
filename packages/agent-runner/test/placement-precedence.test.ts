import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync} from 'node:fs';
import {performSlice, type SliceAgentRunner} from '../src/slicing.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	isolatePiAgentDir,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * End-to-end tests for the RUNNER-DETERMINISTIC SLICE PLACEMENT (slice
 * `runner-deterministic-slice-placement-policy-and-precedence`, governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`). The pure
 * resolver is unit-tested in `placement.test.ts`; THIS file drives each
 * precedence rung end-to-end through the actual `do prd:<slug>` slicing path,
 * against a `--bare file://` arbiter (the house pattern in
 * `test/helpers/gitRepo.ts`).
 *
 * The four rungs (highest wins):
 *
 *   explicit operator flag  >  untrusted-origin \u21d2 staging  >  slicesLandIn
 *     default  >  built-in (staging)
 *
 * The seam under test: the agent ALWAYS writes to `work/tasks/backlog/`; the
 * RUNNER redirects the emitted files to the resolved destination at integrate-
 * stage time \u2014 the agent's emitted output lands where the runner's
 * policy/trust dictates, NOT where the agent wrote it (AC #4 / PRD US #15).
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-slice-placement-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

/**
 * Seed a `work/briefs/ready/<slug>.md` (committed onto the arbiter), optionally stamped
 * with an `originTrust:` provenance (`trusted` | `untrusted`). The slicer reads
 * this stamp from the held PRD and feeds it as the trust signal into the
 * runner-deterministic placement resolver.
 */
function seedPrd(
	repo: string,
	slug: string,
	originTrust?: 'trusted' | 'untrusted',
): void {
	const dir = join(repo, 'work', 'briefs', 'ready');
	mkdirSync(dir, {recursive: true});
	const fm = [
		'---',
		`title: ${slug} \u2014 slice me`,
		`slug: ${slug}`,
		...(originTrust !== undefined
			? ['origin: issue', `originTrust: ${originTrust}`]
			: []),
		'---',
		'',
		'## Problem Statement',
		'',
		`PRD body for ${slug}.`,
		'',
	].join('\n');
	writeFileSync(join(dir, `${slug}.md`), fm);
	run('git', ['add', '-A'], repo, {env: gitEnv()});
	run('git', ['commit', '-q', '-m', `prd: ${slug}`], repo, {env: gitEnv()});
	run('git', ['push', '-q', ARBITER, 'main'], repo, {env: gitEnv()});
}

/**
 * An agent that writes one slice file to `work/tasks/backlog/<file>.md` (the
 * STAGING folder, where the agent ALWAYS writes \u2014 the agent never picks
 * placement; the runner does). The runner redirects the emitted file to the
 * resolved destination at integrate-stage time.
 */
function slicingAgent(file = 'child'): SliceAgentRunner {
	return ({cwd}) => {
		const dir = join(cwd, 'work', 'tasks', 'backlog');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, `${file}.md`),
			[
				'---',
				`title: ${file}`,
				`slug: ${file}`,
				'prd: it',
				'---',
				'',
				'## Prompt',
				'',
				'> build it',
				'',
			].join('\n'),
		);
		return {ok: true};
	};
}

/**
 * An agent that ALSO writes a slice to `work/tasks/todo/` (the POOL) \u2014 modelling
 * a misbehaving / compromised agent trying to self-place into the
 * agent-eligible pool. The PRD's `placement-is-runner-deterministic-...` ADR
 * forbids this: the runner's scrub fence removes the pool drift before
 * committing, and the resolver decides the actual destination from unforgeable
 * inputs.
 */
function selfPlacingAgent(file = 'child'): SliceAgentRunner {
	return ({cwd}) => {
		const staging = join(cwd, 'work', 'tasks', 'backlog');
		const pool = join(cwd, 'work', 'tasks', 'todo');
		mkdirSync(staging, {recursive: true});
		mkdirSync(pool, {recursive: true});
		const body = [
			'---',
			`title: ${file}`,
			`slug: ${file}`,
			'prd: it',
			'---',
			'',
			'## Prompt',
			'',
			'> build it',
			'',
		].join('\n');
		// The agent ALSO writes to the pool, trying to self-place itself eligible.
		writeFileSync(join(pool, `${file}.md`), body);
		// And to the staging area, the legitimate write the slicer methodology
		// instructs.
		writeFileSync(join(staging, `${file}.md`), body);
		return {ok: true};
	};
}

const onArbiterMain = (repo: string, path: string): boolean => {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return (
		run('git', ['cat-file', '-e', `${ARBITER}/main:${path}`], repo, {
			env: gitEnv(),
		}).status === 0
	);
};

// --------------------------------------------------------------------------
// RUNG 4 (lowest): the BUILT-IN floor \u2014 unset everywhere \u21d2 staging.
// --------------------------------------------------------------------------
describe('placement rung 4: built-in floor (no slicesLandIn, no explicit, trusted origin) \u21d2 staging', () => {
	it('lands the slice in work/tasks/backlog/ on the arbiter main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			agentRunner: slicingAgent('child'),
			// No slicesLandIn, no explicitSlicesLandIn \u2014 the resolver's built-in
			// floor applies (`staging` = `pre-backlog/`).
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/todo/child.md')).toBe(false);
		// The honest reporting: `result.emitted` reflects the runner-resolved
		// destination, not where the agent wrote it.
		expect(result.emitted).toEqual(['work/tasks/backlog/child.md']);
	});
});

// --------------------------------------------------------------------------
// RUNG 3: the configured default \u2014 BOTH landings verified.
// --------------------------------------------------------------------------
describe('placement rung 3: slicesLandIn default \u2014 both landings verified', () => {
	it('slicesLandIn: backlog + trusted origin \u21d2 lands in work/tasks/todo/ (the pool)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', 'trusted');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			slicesLandIn: 'backlog',
			agentRunner: slicingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		// The trusted-fast-path landing: the slice lands STRAIGHT IN the
		// agent-eligible pool, no human-promotion step needed.
		expect(onArbiterMain(repo, 'work/tasks/todo/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(false);
		expect(result.emitted).toEqual(['work/tasks/todo/child.md']);
	});

	it('slicesLandIn: pre-backlog + trusted origin \u21d2 lands STAGED in work/tasks/backlog/', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', 'trusted');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			slicesLandIn: 'pre-backlog',
			agentRunner: slicingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/todo/child.md')).toBe(false);
	});
});

// --------------------------------------------------------------------------
// RUNG 2: the UNTRUSTED-ORIGIN force.
// --------------------------------------------------------------------------
describe('placement rung 2: untrusted-origin forces STAGING even on a slicesLandIn: backlog repo', () => {
	it('untrusted PRD + slicesLandIn: backlog \u21d2 staged in work/tasks/backlog/ (untrusted force overrides configured default)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', 'untrusted');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			// The repo's configured default would land slices in the POOL \u2014 but
			// the PRD is untrusted-origin, so the runner forces STAGING.
			slicesLandIn: 'backlog',
			agentRunner: slicingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/todo/child.md')).toBe(false);
	});

	it('a TRUSTED PRD on a slicesLandIn: backlog repo still lands in the pool (the untrusted force only fires on untrusted; zero behaviour change for the normal path)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', 'trusted');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			slicesLandIn: 'backlog',
			agentRunner: slicingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(onArbiterMain(repo, 'work/tasks/todo/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(false);
	});

	it('an UNSTAMPED PRD (no origin/originTrust) follows the configured default (untrusted force does not fire; trusted-by-default)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it'); // no origin/originTrust stamp \u2014 treated as trusted
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			slicesLandIn: 'backlog',
			agentRunner: slicingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(onArbiterMain(repo, 'work/tasks/todo/child.md')).toBe(true);
	});
});

// --------------------------------------------------------------------------
// RUNG 1 (top): the EXPLICIT OPERATOR FLAG.
// --------------------------------------------------------------------------
describe('placement rung 1: explicit operator flag wins over the untrusted-origin force', () => {
	it('explicit --slices-land-in backlog + untrusted PRD \u21d2 lands in work/tasks/todo/ (operator override beats the untrusted force)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', 'untrusted');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			// A repo whose configured default is staging \u2026
			slicesLandIn: 'pre-backlog',
			// \u2026 but the operator EXPLICITLY typed --slices-land-in backlog. The
			// operator is present; CLI always wins (no special force-key), exactly
			// like `--merge` overriding the untrusted-origin build-propose rule.
			explicitSlicesLandIn: 'backlog',
			agentRunner: slicingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(onArbiterMain(repo, 'work/tasks/todo/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(false);
	});

	it('explicit --slices-land-in pre-backlog + slicesLandIn: backlog + trusted origin \u21d2 lands STAGED (operator override beats configured default)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', 'trusted');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			slicesLandIn: 'backlog',
			explicitSlicesLandIn: 'pre-backlog',
			agentRunner: slicingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/todo/child.md')).toBe(false);
	});
});

// --------------------------------------------------------------------------
// The "runner places, not the agent" structural invariant (AC #4 / US #15).
// --------------------------------------------------------------------------
describe("the agent's emitted output lands where the RUNNER's policy dictates, not where the agent wrote", () => {
	it('a SELF-PLACING agent (writes to both pre-backlog AND backlog) is scrubbed; the runner places the slice via the resolver', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', 'trusted');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			// The repo's resolved default lands in STAGING; the agent's
			// attempted self-placement into the pool is scrubbed; the runner's
			// commit reflects ONLY the policy-resolved destination.
			slicesLandIn: 'pre-backlog',
			agentRunner: selfPlacingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		// The runner placed the slice in STAGING per the configured default; the
		// agent's pool-drift attempt was scrubbed (not on main).
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/todo/child.md')).toBe(false);
	});

	it('a SELF-PLACING agent on an UNTRUSTED PRD lands STAGED \u2014 the agent cannot bypass the untrusted-origin force by writing into the pool', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', 'untrusted');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			// Even on a repo that defaults to landing in the pool, the runner
			// FORCES staging for the untrusted origin and scrubs the agent's
			// pool write.
			slicesLandIn: 'backlog',
			agentRunner: selfPlacingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/todo/child.md')).toBe(false);
	});
});
