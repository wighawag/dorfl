import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performTask, type TaskDorfl} from '../src/tasking.js';
import {
	performIntake,
	type IntakeVerdict,
	type LoneTaskReviewGate,
} from '../src/intake.js';
import {performRecoverIsolated} from '../src/recover-isolated.js';
import * as integrationCore from '../src/integration-core.js';
import {createJob} from '../src/workspace.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * `thread-merge-retries-cross-task-and-ratify-default` (follow-up to
 * `merge-retries-gate-precedence`): the resolved `mergeRetries` cap must reach
 * `performIntegration` on the FOUR remaining callers the original task did NOT
 * thread — `tasking.ts` (the `do spec:` tasking-transition), `intake.ts` (the
 * lone-task emit + the spec emit), and `recover-isolated.ts` (the
 * `complete --isolated` recovery). Before this task only `run.ts`/`do.ts`/
 * `complete.ts` forwarded it, so a per-repo cap was silently dropped on these
 * paths and the engine default took over — the correctness gap this task
 * closes.
 *
 * House style: spy on `integration-core.performIntegration` and capture the
 * `mergeRetries` argument. The mock throws a sentinel so the caller does not
 * need a full IntegrationCoreResult back — we assert the THREADING, not the
 * downstream integrate. Each site is a small end-to-end call (real spec/issue
 * seed, real seams) so a refactor that drops the wiring fails LOUDLY here.
 * Table-driven in spirit: one shared assertion per site (`mergeRetries: 42`
 * in, 42 out).
 */

const ARBITER = 'arbiter';
const SENTINEL = 'MERGE_RETRIES_THREADING_STOP';
const CAP = 42;

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-merge-retries-threading-');
});
afterEach(() => {
	vi.restoreAllMocks();
	scratch.cleanup();
});

/**
 * Install a spy on `performIntegration` that CAPTURES its input then throws a
 * sentinel. Return the captured-input holder so the caller can assert on it
 * after awaiting a rejected promise. Threading — not downstream integrate — is
 * what these tests pin.
 */
function spyPerformIntegration(): {input?: {mergeRetries?: number}} {
	const captured: {input?: {mergeRetries?: number}} = {};
	vi.spyOn(integrationCore, 'performIntegration').mockImplementation(
		async (input) => {
			captured.input = input as {mergeRetries?: number};
			throw new Error(SENTINEL);
		},
	);
	return captured;
}

// ---------------------------------------------------------------------------
// tasking.ts — the `do spec:<slug>` tasking-transition path
// ---------------------------------------------------------------------------

/** A tiny tasker agent that writes one backlog task file (no git). */
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
				'spec: it',
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

describe('tasking — the `do spec:` tasking-transition threads mergeRetries into performIntegration', () => {
	it('forwards the resolved cap verbatim to the shared integrate core', async () => {
		// `specs: ['it']` seeds `work/specs/ready/it.md` onto the arbiter (the
		// tasking source the lock holds); the agent writes ONE backlog task.
		const {repo} = seedRepoWithArbiter(scratch.root, [], {specs: ['it']});
		const spy = spyPerformIntegration();

		await expect(
			performTask({
				slug: 'it',
				cwd: repo,
				arbiter: ARBITER,
				autoTask: true,
				explicit: true,
				integration: 'merge',
				dorfl: taskingAgent('child'),
				mergeRetries: CAP,
				env: gitEnv(),
			}),
		).rejects.toThrow(SENTINEL);

		expect(spy.input?.mergeRetries).toBe(CAP);
	});
});

// ---------------------------------------------------------------------------
// intake.ts — dispatchTask (lone-task emit) + dispatchSpec (spec emit)
// ---------------------------------------------------------------------------

/**
 * A stubbed issue seam — the minimum surface `performIntake` needs to reach the
 * dispatch step (no `gh`/network, no lock). Modelled after `intake.test.ts`'s
 * `stubIssueProvider`, trimmed to the fields exercised here.
 */
function stubIssueProvider() {
	return {
		name: 'stub',
		async getIssue({issueNumber}: {issueNumber: number}) {
			return {
				number: issueNumber,
				title: 'title',
				body: 'body',
				author: 'octocat',
				state: 'open' as const,
			};
		},
		async listComments() {
			return [];
		},
		async postIssueComment({issueNumber}: {issueNumber: number}) {
			return {posted: true, instruction: `commented on #${issueNumber}`};
		},
		async closeIssue({issueNumber}: {issueNumber: number}) {
			return {closed: true, instruction: `closed #${issueNumber}`};
		},
		async getLabels() {
			return {
				outcome: 'unsupported' as const,
				supported: false,
				labels: [] as string[],
				instruction: 'no label support',
			};
		},
		async addLabel() {
			return {
				outcome: 'unsupported' as const,
				applied: false,
				instruction: 'no label support',
			};
		},
		async removeLabel() {
			return {
				outcome: 'unsupported' as const,
				applied: false,
				instruction: 'no label support',
			};
		},
	};
}

const convergingReviewGate: LoneTaskReviewGate = async () => ({
	verdict: 'approve',
	findings: [],
});

const TASK_VERDICT: IntakeVerdict = {
	outcome: 'task',
	taskSlug: 'add-quiet-flag',
	taskTitle: 'Add a --quiet flag',
	taskBody: '## Prompt\n\n> Add a --quiet flag.\n',
};

const SPEC_VERDICT: IntakeVerdict = {
	outcome: 'spec',
	specSlug: 'quiet-modes',
	specTitle: 'Quiet and verbose output modes',
	specBody: '## Problem Statement\n\nModes.\n',
};

describe('intake — a `task` verdict threads mergeRetries into performIntegration', () => {
	it('forwards the resolved cap to the lone-task emit shared integrate core', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const spy = spyPerformIntegration();

		await expect(
			performIntake({
				issueNumber: 42,
				cwd: repo,
				arbiter: ARBITER,
				issueProvider: stubIssueProvider(),
				decide: async () => TASK_VERDICT,
				reviewTask: convergingReviewGate,
				integration: {task: 'merge', spec: 'propose'},
				mergeRetries: CAP,
				env: gitEnv(),
			}),
		).rejects.toThrow(SENTINEL);

		expect(spy.input?.mergeRetries).toBe(CAP);
	});
});

describe('intake — a `spec` verdict threads mergeRetries into performIntegration', () => {
	it('forwards the resolved cap to the spec emit shared integrate core', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const spy = spyPerformIntegration();

		await expect(
			performIntake({
				issueNumber: 42,
				cwd: repo,
				arbiter: ARBITER,
				issueProvider: stubIssueProvider(),
				decide: async () => SPEC_VERDICT,
				integration: {task: 'propose', spec: 'merge'},
				mergeRetries: CAP,
				env: gitEnv(),
			}),
		).rejects.toThrow(SENTINEL);

		expect(spy.input?.mergeRetries).toBe(CAP);
	});
});

// ---------------------------------------------------------------------------
// recover-isolated.ts — `complete --isolated <slug>` recovery
// ---------------------------------------------------------------------------

/** The temp agents' execution area (worktrees + mirrors live here). */
function workspacesDir(): string {
	return join(scratch.root, 'agents-area');
}

/**
 * Materialise a REAL retained job worktree for `slug` off the seeded repo's
 * arbiter, then STRAND it (agent work + done-move committed, NOT pushed) — the
 * minimum shape `performRecoverIsolated` needs to reach `performIntegration`.
 * Mirrors `recover-isolated.test.ts`'s helper (kept local, small: this file
 * pins ONE property — the mergeRetries threading — not the recovery flow).
 */
async function seedStrandedWorktree(
	seeded: SeededRepo,
	slug: string,
): Promise<{worktreeDir: string; arbiterUrl: string}> {
	const ws = workspacesDir();
	const arbiterUrl = `file://${seeded.arbiter}`;
	const claim = await performClaim({
		slug,
		cwd: seeded.repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	const job = createJob({
		url: arbiterUrl,
		slug,
		workspacesDir: ws,
		env: gitEnv(),
	});
	const dir = job.dir;
	writeFileSync(join(dir, 'feature.txt'), 'the work\n');
	mkdirSync(join(dir, 'work', 'tasks', 'done'), {recursive: true});
	gitIn(
		['mv', `work/tasks/ready/${slug}.md`, `work/tasks/done/${slug}.md`],
		dir,
	);
	gitIn(['add', '-A'], dir);
	gitIn(['commit', '-q', '-m', `feat(${slug}): build; done`], dir);
	return {worktreeDir: dir, arbiterUrl};
}

describe('recover-isolated — `complete --isolated` threads mergeRetries into performIntegration', () => {
	it('forwards the resolved cap to the committed-recovery shared integrate core', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		await seedStrandedWorktree(seeded, 'alpha');
		const spy = spyPerformIntegration();

		await expect(
			performRecoverIsolated({
				slug: 'alpha',
				cwd: seeded.repo,
				arbiter: ARBITER,
				workspacesDir: workspacesDir(),
				integration: 'merge',
				mergeRetries: CAP,
				env: gitEnv(),
			}),
		).rejects.toThrow(SENTINEL);

		expect(spy.input?.mergeRetries).toBe(CAP);
	});
});
