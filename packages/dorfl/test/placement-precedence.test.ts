import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync} from 'node:fs';
import {performTask, type TaskDorfl} from '../src/tasking.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	isolatePiAgentDir,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * End-to-end tests for the RUNNER-DETERMINISTIC TASK PLACEMENT (task
 * `runner-deterministic-slice-placement-policy-and-precedence`, governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`). The pure
 * resolver is unit-tested in `placement.test.ts`; THIS file drives each
 * precedence rung end-to-end through the actual `do prd:<slug>` tasking path,
 * against a `--bare file://` arbiter (the house pattern in
 * `test/helpers/gitRepo.ts`).
 *
 * The rungs (highest wins), after the untrusted-forces-staging rung was RETIRED
 * (ADR `untrusted-origin-carries-via-stamp-not-forced-staging`):
 *
 *   explicit operator flag  >  configured default  >  built-in (staging)
 *
 * Author-trust no longer FORCES staging inside the resolver: `performTask` reads
 * the tasked spec's propagated `originTrust:` stamp and SELECTS which configured
 * default applies — `untrustedTasksLandIn` for an untrusted spec (default
 * staging; `ready` when configured), `tasksLandIn` for a trusted/unset spec —
 * before calling the pure resolver. Safety for an untrusted task landing in
 * `ready` is the carried stamp (its BUILD is forced to a code PR), not the
 * folder.
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
	scratch = makeScratch('dorfl-task-placement-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

/**
 * Seed a `work/specs/ready/<slug>.md` (committed onto the arbiter), optionally stamped
 * with an `originTrust:` provenance (`trusted` | `untrusted`). The tasker reads
 * this stamp from the held PRD and feeds it as the trust signal into the
 * runner-deterministic placement resolver.
 */
function seedPrd(
	repo: string,
	slug: string,
	originTrust?: 'trusted' | 'untrusted',
): void {
	const dir = join(repo, 'work', 'specs', 'ready');
	mkdirSync(dir, {recursive: true});
	const fm = [
		'---',
		`title: ${slug} \u2014 task me`,
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
 * An agent that writes one task file to `work/tasks/backlog/<file>.md` (the
 * STAGING folder, where the agent ALWAYS writes \u2014 the agent never picks
 * placement; the runner does). The runner redirects the emitted file to the
 * resolved destination at integrate-stage time.
 */
function taskingAgent(file = 'child'): TaskDorfl {
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
 * An agent that ALSO writes a task to `work/tasks/ready/` (the POOL) \u2014 modelling
 * a misbehaving / compromised agent trying to self-place into the
 * agent-eligible pool. The PRD's `placement-is-runner-deterministic-...` ADR
 * forbids this: the runner's scrub fence removes the pool drift before
 * committing, and the resolver decides the actual destination from unforgeable
 * inputs.
 */
function selfPlacingAgent(file = 'child'): TaskDorfl {
	return ({cwd}) => {
		const staging = join(cwd, 'work', 'tasks', 'backlog');
		const pool = join(cwd, 'work', 'tasks', 'ready');
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
		// And to the staging area, the legitimate write the tasker methodology
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
describe('placement rung 4: built-in floor (no tasksLandIn, no explicit, trusted origin) \u21d2 staging', () => {
	it('lands the task in work/tasks/backlog/ on the arbiter main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			dorfl: taskingAgent('child'),
			// No tasksLandIn, no explicitTasksLandIn \u2014 the resolver's built-in
			// floor applies (`staging` = `tasks/backlog/`).
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/ready/child.md')).toBe(false);
		// The honest reporting: `result.emitted` reflects the runner-resolved
		// destination, not where the agent wrote it.
		expect(result.emitted).toEqual(['work/tasks/backlog/child.md']);
	});
});

// --------------------------------------------------------------------------
// RUNG 3: the configured default \u2014 BOTH landings verified.
// --------------------------------------------------------------------------
describe('placement rung 3: tasksLandIn default \u2014 both landings verified', () => {
	it('tasksLandIn: ready + trusted origin \u21d2 lands in work/tasks/ready/ (the pool)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', 'trusted');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			tasksLandIn: 'ready',
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		// The trusted-fast-path landing: the task lands STRAIGHT IN the
		// agent-eligible pool, no human-promotion step needed.
		expect(onArbiterMain(repo, 'work/tasks/ready/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(false);
		expect(result.emitted).toEqual(['work/tasks/ready/child.md']);
	});

	it('tasksLandIn: backlog + trusted origin \u21d2 lands STAGED in work/tasks/backlog/', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', 'trusted');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			tasksLandIn: 'backlog',
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/ready/child.md')).toBe(false);
	});
});

// --------------------------------------------------------------------------
// RUNG 2: the STAMP-SELECTED configured default (the untrusted twin).
// The untrusted-forces-staging rung is GONE (ADR
// `untrusted-origin-carries-via-stamp-not-forced-staging`); an untrusted spec
// selects `untrustedTasksLandIn` (default staging; `ready` when configured).
// --------------------------------------------------------------------------
describe('placement rung 2: an untrusted-origin spec selects untrustedTasksLandIn (default staging; opt-in ready), carrying the stamp', () => {
	it('untrusted PRD, DEFAULT untrusted knob (unset) + tasksLandIn: ready \u21d2 staged in work/tasks/backlog/ (untrusted default is staging; the trusted tasksLandIn does NOT apply to it)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', 'untrusted');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			// The repo's TRUSTED default lands in the POOL \u2014 but the spec is
			// untrusted, so the tasker reads the stamp and selects the UNTRUSTED
			// knob, which is UNSET here \u21d2 the built-in floor (staging). This is
			// the default (zero behaviour change vs the old forced-staging).
			tasksLandIn: 'ready',
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/ready/child.md')).toBe(false);
	});

	it('untrusted PRD + untrustedTasksLandIn: ready \u21d2 lands in work/tasks/ready/ (the pool) STILL CARRYING the propagated originTrust: untrusted stamp \u2014 the mode the old hard rung could not express', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', 'untrusted');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			// The repo OPTS an untrusted task into the pool explicitly; safety is
			// then the carried stamp (a build PR), not the folder.
			untrustedTasksLandIn: 'ready',
			// The trusted default is irrelevant here (the spec is untrusted); set it
			// to staging to prove the UNTRUSTED knob is what selected the pool.
			tasksLandIn: 'backlog',
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		expect(onArbiterMain(repo, 'work/tasks/ready/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(false);
		expect(result.emitted).toEqual(['work/tasks/ready/child.md']);
		// The task landed in the POOL but STILL carries the propagated stamp \u2014
		// "safe in the pool" is real (the build transition reads this to force a
		// code PR). Fetch the landed file off the arbiter and assert the stamp.
		run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
		const landed = run(
			'git',
			['show', `${ARBITER}/main:work/tasks/ready/child.md`],
			repo,
			{env: gitEnv()},
		).stdout;
		expect(landed).toContain('originTrust: untrusted');
	});

	it('a TRUSTED PRD on a tasksLandIn: ready repo lands in the pool (trusted selects the trusted knob; zero behaviour change for the normal path)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', 'trusted');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			tasksLandIn: 'ready',
			// The untrusted knob is set to staging; a TRUSTED spec must NOT read it.
			untrustedTasksLandIn: 'backlog',
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		expect(onArbiterMain(repo, 'work/tasks/ready/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(false);
	});

	it('an UNSTAMPED PRD (no origin/originTrust) follows the TRUSTED configured default (treated as trusted-by-default; the untrusted knob does not apply)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it'); // no origin/originTrust stamp \u2014 treated as trusted
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			tasksLandIn: 'ready',
			untrustedTasksLandIn: 'backlog',
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		expect(onArbiterMain(repo, 'work/tasks/ready/child.md')).toBe(true);
	});
});

// --------------------------------------------------------------------------
// RUNG 1 (top): the EXPLICIT OPERATOR FLAG.
// --------------------------------------------------------------------------
describe('placement rung 1: explicit operator flag wins over the configured default (including an untrusted spec whose untrusted default is staging)', () => {
	it('explicit --tasks-land-in ready + untrusted PRD (untrusted default staging) \u21d2 lands in work/tasks/ready/ (operator override beats the stamp-selected default)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', 'untrusted');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			// The untrusted default is staging (unset \u21d2 floor) \u2026
			tasksLandIn: 'backlog',
			// \u2026 but the operator EXPLICITLY typed --tasks-land-in ready. The
			// operator is present; CLI always wins (no special force-key), exactly
			// like `--merge` overriding the untrusted-origin build-propose rule.
			explicitTasksLandIn: 'ready',
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		expect(onArbiterMain(repo, 'work/tasks/ready/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(false);
	});

	it('explicit --tasks-land-in backlog + tasksLandIn: ready + trusted origin \u21d2 lands STAGED (operator override beats configured default)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', 'trusted');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			tasksLandIn: 'ready',
			explicitTasksLandIn: 'backlog',
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/ready/child.md')).toBe(false);
	});
});

// --------------------------------------------------------------------------
// The "runner places, not the agent" structural invariant (AC #4 / US #15).
// --------------------------------------------------------------------------
describe("the agent's emitted output lands where the RUNNER's policy dictates, not where the agent wrote", () => {
	it('a SELF-PLACING agent (writes to both backlog AND ready) is scrubbed; the runner places the task via the resolver', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', 'trusted');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			// The repo's resolved default lands in STAGING; the agent's
			// attempted self-placement into the pool is scrubbed; the runner's
			// commit reflects ONLY the policy-resolved destination.
			tasksLandIn: 'backlog',
			dorfl: selfPlacingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		// The runner placed the task in STAGING per the configured default; the
		// agent's pool-drift attempt was scrubbed (not on main).
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/ready/child.md')).toBe(false);
	});

	it('a SELF-PLACING agent on an UNTRUSTED PRD (untrusted default staging) lands STAGED \u2014 the agent cannot self-place into the pool, and the untrusted default keeps it staged', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', 'untrusted');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			// The TRUSTED default is the pool, but the spec is untrusted, so the
			// tasker selects the UNTRUSTED knob (unset \u21d2 the staging floor) and
			// scrubs the agent's pool write.
			tasksLandIn: 'ready',
			dorfl: selfPlacingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/ready/child.md')).toBe(false);
	});
});
