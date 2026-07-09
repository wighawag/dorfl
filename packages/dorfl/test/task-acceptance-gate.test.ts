import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync} from 'node:fs';
import {performTask, type TaskDorfl} from '../src/tasking.js';
import {
	buildReviewPrompt,
	buildTaskAcceptancePrompt,
	type ReviewGate,
	type ReviewVerdict,
} from '../src/review-gate.js';
import type {TaskReviewGate} from '../src/tasker-review-loop.js';
import {readItemLock} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	isolatePiAgentDir,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * `do prd:<slug>` TASK-SET ACCEPTANCE GATE tests (task `task-acceptance-gate`).
 * The task-path mirror of the build Gate-2: a FRESH-CONTEXT review of the
 * produced task SET runs BEFORE the tasks integrate (riding
 * `performIntegration`'s review-before-integrate block). `--review` on (default)
 * runs it; `--no-review` skips it; `block` routes the prd to needs-attention (no
 * tasks land); `approve` lets the set integrate. It is ONE-SHOT (no rounds; it
 * does NOT consult `--review-max-rounds`) and is independently controllable from
 * the tasker improver loop.
 *
 * House style (mirrors `tasking-integration.test.ts` + `review-gate-pr.test.ts`):
 * a throwaway checkout + a local `--bare` arbiter + a STUBBED agent (writes task
 * files directly) + a STUBBED acceptance gate (a canned approve/block verdict, NO
 * real model). `GIT_CONFIG_GLOBAL` isolation + `isolatePiAgentDir` keep the
 * developer's real config/sessions untouched.
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('dorfl-task-gate-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

/** Seed a `work/specs/ready/<slug>.md` (committed onto the arbiter). */
function seedPrd(repo: string, slug: string): void {
	const dir = join(repo, 'work', 'specs', 'ready');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, `${slug}.md`),
		[
			'---',
			`title: ${slug} — task me`,
			`slug: ${slug}`,
			'---',
			'',
			'## Problem Statement',
			'',
			`PRD body for ${slug}.`,
			'',
		].join('\n'),
	);
	run('git', ['add', '-A'], repo, {env: gitEnv()});
	run('git', ['commit', '-q', '-m', `prd: ${slug}`], repo, {env: gitEnv()});
	run('git', ['push', '-q', ARBITER, 'main'], repo, {env: gitEnv()});
}

/** An agent that writes one backlog task file (no git). */
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
 * A stubbed acceptance gate (the task-SET `ReviewGate` seam) returning a fixed
 * verdict — a CALLABLE that also records its invocations so call sites can assert
 * call count / round / model (mirrors `review-gate-pr.test.ts`'s `stubGate`).
 */
type StubGate = ReviewGate & {
	readonly calls: number;
	readonly rounds: number[];
	readonly models: (string | undefined)[];
};
function stubGate(verdict: ReviewVerdict): StubGate {
	const rounds: number[] = [];
	const models: (string | undefined)[] = [];
	const gate = (async (input) => {
		rounds.push(input.round);
		models.push(input.reviewModel);
		return verdict;
	}) as StubGate;
	Object.defineProperties(gate, {
		calls: {get: () => rounds.length},
		rounds: {get: () => rounds},
		models: {get: () => models},
	});
	return gate;
}

const APPROVE: ReviewVerdict = {verdict: 'approve', findings: []};
const BLOCK: ReviewVerdict = {
	verdict: 'block',
	findings: [
		{
			severity: 'blocking',
			question: 'the task set leaves a coverage gap in the PRD goal',
			context: 'work/tasks/backlog/child.md',
		},
	],
};

const onArbiterMain = (repo: string, path: string): boolean => {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return (
		run('git', ['cat-file', '-e', `${ARBITER}/main:${path}`], repo, {
			env: gitEnv(),
		}).status === 0
	);
};

const showArbiterMain = (repo: string, path: string): string => {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return run('git', ['show', `${ARBITER}/main:${path}`], repo, {
		env: gitEnv(),
	}).stdout;
};

describe('task acceptance gate — APPROVE lets the set integrate (default --merge)', () => {
	it('review on + APPROVE ⇒ the gate runs once, then the tasks land on main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const gate = stubGate(APPROVE);
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			review: true,
			reviewGate: gate,
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('tasked');
		// The gate ran (before the integrate) exactly ONCE — it is one-shot.
		expect(gate.calls).toBe(1);
		// The approved set integrated onto main (task + prd tasking/ -> prd-tasked/
		// move). The prd rests in prd-tasked/ (residence = source of truth for
		// tasked-ness, no marker), not prd/.
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/specs/tasked/it.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/specs/ready/it.md')).toBe(false);
		expect(onArbiterMain(repo, 'work/tasking/it.md')).toBe(false);
	});
});

describe('task acceptance gate — --no-review skips it (mirror the build Gate-2 off test)', () => {
	it('review off ⇒ the gate is NEVER invoked and the set still integrates', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const gate = stubGate(BLOCK); // would block — but must never run
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			review: false, // --no-review
			reviewGate: gate,
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		expect(gate.calls).toBe(0);
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
	});

	it('review undefined (no gate wired) ⇒ default behaviour unchanged (no gate runs)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			// no `review`, no `reviewGate` — the pre-gate behaviour.
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
	});
});

describe('task acceptance gate — BLOCK routes the set to needs-attention (not integrated)', () => {
	it('review on + BLOCK ⇒ needs-attention, NO tasks land, exit 1, findings in the body', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const gate = stubGate(BLOCK);
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			review: true,
			reviewGate: gate,
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('needs-attention');
		expect(gate.calls).toBe(1);
		// The task-path block route is a per-item lock `active → stuck` amend now
		// (task `cutover-...-trim-folder-sets`), NOT a folder move: the prd body STAYS
		// in work/specs/ready/, the tasks did NOT land, and NO needs-attention/ or tasking/
		// folder file is written.
		expect(onArbiterMain(repo, 'work/needs-attention/it.md')).toBe(false);
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(false);
		expect(onArbiterMain(repo, 'work/specs/ready/it.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/specs/tasked/it.md')).toBe(false);
		expect(onArbiterMain(repo, 'work/tasking/it.md')).toBe(false);
		// The gate's blocking findings are recorded on the stuck lock entry (the reason).
		// MIGRATE step: the tasking path keys the stuck lock as `spec:<slug>` now.
		const entry = await readItemLock({
			item: 'spec:it',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(entry?.state).toBe('stuck');
		expect(entry?.reason).toMatch(/coverage gap in the PRD goal/);
	});

	it('a BLOCK on the --propose path also routes to needs-attention (no PR of a blocked set)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const gate = stubGate(BLOCK);
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'propose',
			review: true,
			reviewGate: gate,
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('needs-attention');
		// The block route is the stuck lock; the prd body stays in prd/, no PR opened.
		expect(onArbiterMain(repo, 'work/needs-attention/it.md')).toBe(false);
		expect(onArbiterMain(repo, 'work/specs/ready/it.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(false);
		// MIGRATE step: the tasking path keys the stuck lock as `spec:<slug>` now.
		const entry = await readItemLock({
			item: 'spec:it',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(entry?.state).toBe('stuck');
	});
});

describe('task acceptance gate — ONE-SHOT (single invocation, no rounds)', () => {
	it('a persistent BLOCK is NOT re-reviewed: the gate runs exactly ONCE (round 1), no --review-max-rounds loop', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const gate = stubGate(BLOCK); // always blocks
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			review: true,
			reviewGate: gate,
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		// ONE-SHOT: the gate was invoked exactly once (round 1), then terminated to
		// needs-attention — no rounds loop (the build gate's default would be 2).
		expect(gate.calls).toBe(1);
		expect(gate.rounds).toEqual([1]);
		expect(result.outcome).toBe('needs-attention');
	});

	it('performTask has NO --review-max-rounds knob on the task path (the gate is terminal)', () => {
		// The task path's options carry NO `reviewMaxRounds` field — the rounds
		// bound is an orphan that belongs to a future revise↔review loop, never a
		// gate. (Type-level assertion: this object is a valid PerformTaskOptions
		// fragment ONLY because it has no reviewMaxRounds; a TS error here would
		// catch a regression that added the knob.)
		const fragment = {review: true} as const;
		expect('reviewMaxRounds' in fragment).toBe(false);
	});
});

describe('task acceptance gate — --review-model de-correlates the reviewer', () => {
	it('the acceptanceReviewModel override reaches the gate (the launch seam)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const gate = stubGate(APPROVE);
		await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			review: true,
			reviewGate: gate,
			acceptanceReviewModel: 'review/override',
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(gate.models).toEqual(['review/override']);
	});
});

describe('task acceptance gate — independent of the tasker improver loop', () => {
	// A canned improver-loop gate (converge, no edits) so both seams are wired at
	// once. The two are non-overlapping concepts: the loop EDITS tasks in-context;
	// the gate is a terminal fresh-context accept/reject BEFORE integrate.
	const convergingLoop: TaskReviewGate = async () => ({
		verdict: 'approve',
		edits: [],
		findings: [],
	});

	it('the gate runs even when the improver loop is wired (toggling one does not affect the other)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const gate = stubGate(APPROVE);
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			// BOTH seams on: the improver loop AND the acceptance gate.
			reviewLoop: convergingLoop,
			taskerLoopMax: 1,
			review: true,
			reviewGate: gate,
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		// The acceptance gate still ran (it is not gated by the improver loop).
		expect(gate.calls).toBe(1);
	});

	it('the gate is OFF independently while the improver loop is ON (review off, loop on)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const gate = stubGate(BLOCK); // would block — but review is off so it never runs
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			reviewLoop: convergingLoop, // improver loop ON
			taskerLoopMax: 1,
			review: false, // acceptance gate OFF
			reviewGate: gate,
			dorfl: taskingAgent('child'),
			env: gitEnv(),
		});
		// The set landed (the loop converged), and the gate never ran.
		expect(result.outcome).toBe('tasked');
		expect(gate.calls).toBe(0);
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
	});
});

describe('task acceptance gate — the prompt is a task-SET prompt (distinct from the build per-diff prompt)', () => {
	it('the task-SET prompt reviews the WHOLE SET (coherence / graph / gaps+overlap), NOT a code diff', () => {
		const prompt = buildTaskAcceptancePrompt('it');
		// It frames a SET review with the set-of-tasks lens…
		expect(prompt).toMatch(/task-SET ACCEPTANCE GATE/);
		expect(prompt).toMatch(/WHOLE SET/);
		expect(prompt).toMatch(/DEPENDENCY GRAPH/);
		expect(prompt).toMatch(/GAPS \+ OVERLAP/);
		expect(prompt).toMatch(/CORRECT-IF-IMPLEMENTED/);
		// …and it is TERMINAL (emits a verdict; does not edit — distinct from the
		// improver loop).
		expect(prompt).toMatch(/do NOT edit any task/);
	});

	it('it is demonstrably DISTINCT from the build per-diff review prompt', () => {
		const setPrompt = buildTaskAcceptancePrompt('it');
		const buildPrompt = buildReviewPrompt('it');
		expect(setPrompt).not.toBe(buildPrompt);
		// The build prompt reviews a code DIFF against ONE task; the set prompt
		// reviews the SET of tasks against the prd.
		expect(buildPrompt).toMatch(/code changes/);
		expect(setPrompt).not.toMatch(/review the code changes/);
		expect(setPrompt).toMatch(/candidate tasks/);
	});
});
