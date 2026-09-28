/**
 * The tree-less rung scenarios the CI phase split is tested on (task
 * `ci-split-treeless-rungs`), shared by `test/ci-phase-treeless.test.ts`,
 * `test/ci-phase-treeless-e2e.test.ts` and its worker. Each is plain data: the
 * files and branches seeded on the arbiter, the item argument, the
 * `observationTriage` policy, and the canned agent emits (the agent phase's
 * seams return them; nothing else ever sees them).
 */

import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {git} from '../../src/git.js';
import {
	newSidecar,
	serialiseSidecar,
	sidecarPathFor,
} from '../../src/sidecar.js';
import type {NewQuestion} from '../../src/sidecar.js';
import type {SurfaceEmit} from '../../src/surface-gate.js';
import type {TriageEmit} from '../../src/triage-gate.js';
import type {DecisionVerdict} from '../../src/decision-engine.js';
import type {ObservationTriage} from '../../src/config.js';
import {gitEnv, type SeededRepo} from './gitRepo.js';

/** The canned emits of the three agent seams. */
export interface ScenarioEmits {
	surface?: SurfaceEmit;
	triage?: TriageEmit;
	verdict?: DecisionVerdict;
}

export interface TreelessScenario {
	name: string;
	/** The `advance` argument. */
	arg: string;
	/** Repository-relative files committed on the arbiter's `main`. */
	files: Record<string, string>;
	/** Branches pushed to the arbiter (from `main`). */
	branches?: string[];
	observationTriage?: ObservationTriage;
	rung: 'surface' | 'triage-observation' | 'apply';
	needsAgent: boolean;
	/** The intent the agent phase hands over (agent scenarios). */
	intent?: 'surface' | 'triage' | 'apply-decision';
	emits: ScenarioEmits;
}

export const OBS = 'noisy-flake';
export const OBS_REL = `work/notes/observations/${OBS}.md`;
export const TASK = 'blocked-task';
export const TASK_REL = `work/tasks/ready/${TASK}.md`;

export function observation(extra: string[] = [], fm: string[] = []): string {
	return [
		'---',
		'title: A noisy flake',
		...fm,
		'---',
		'',
		'The retry test flakes under load.',
		'',
		...extra,
	].join('\n');
}

function task(fm: string[] = []): string {
	return [
		'---',
		'title: A blocked task',
		`slug: ${TASK}`,
		...fm,
		'blockedBy: []',
		'---',
		'',
		'## What to build',
		'',
		'Something.',
		'',
		'## Prompt',
		'',
		'> Build it.',
		'',
	].join('\n');
}

/** An answered sidecar for `item` (every question answered with its `answer`). */
export function answeredSidecar(
	item: string,
	entries: (NewQuestion & {answer: string})[],
): string {
	const model = newSidecar(
		item,
		entries.map(({answer: _a, ...q}) => q),
	);
	return serialiseSidecar({
		...model,
		entries: model.entries.map((e, i) => ({...e, answer: entries[i].answer})),
	});
}

const OBS_ITEM = `observation:${OBS}`;
const TASK_ITEM = `task:${TASK}`;

/** An answered observation (`needsAnswers: true`, every question answered). */
function answeredObservation(answer: string): Record<string, string> {
	return {
		[OBS_REL]: observation([], ['needsAnswers: true']),
		[sidecarPathFor(OBS_ITEM)]: answeredSidecar(OBS_ITEM, [
			{question: 'What should become of this observation?', answer},
		]),
	};
}

function applyDecision(
	name: string,
	answer: string,
	verdict: DecisionVerdict,
): TreelessScenario {
	return {
		name,
		arg: `obs:${OBS}`,
		files: answeredObservation(answer),
		rung: 'apply',
		needsAgent: true,
		intent: 'apply-decision',
		emits: {verdict},
	};
}

export const SCENARIOS: readonly TreelessScenario[] = [
	{
		name: 'triage marker back-fill',
		arg: `obs:${OBS}`,
		files: {
			[OBS_REL]: observation([
				'## Applied answers',
				'',
				'- q1: keep it on record.',
				'',
			]),
		},
		rung: 'triage-observation',
		needsAgent: false,
		emits: {},
	},
	{
		name: 'triage auto-dispose under auto',
		arg: `obs:${OBS}`,
		files: {
			[OBS_REL]: observation(),
			'work/tasks/ready/fix-the-flake.md': task(),
		},
		observationTriage: 'auto',
		rung: 'triage-observation',
		needsAgent: true,
		intent: 'triage',
		emits: {
			triage: {
				auto: true,
				kind: 'duplicate',
				existing: 'task:fix-the-flake',
				reason: 'The task already carries this signal.',
			},
		},
	},
	{
		name: 'triage fall-through to surface',
		arg: `obs:${OBS}`,
		files: {
			[OBS_REL]: observation([
				'## Open questions',
				'',
				'- Is it the runner or the test?',
				'',
			]),
		},
		observationTriage: 'ask',
		rung: 'triage-observation',
		needsAgent: true,
		intent: 'triage',
		emits: {
			surface: {questions: [{question: 'Is it the runner or the test?'}]},
		},
	},
	{
		name: 'surface with questions',
		arg: `task:${TASK}`,
		files: {[TASK_REL]: task(['needsAnswers: true'])},
		rung: 'surface',
		needsAgent: true,
		intent: 'surface',
		emits: {
			surface: {
				questions: [
					{question: 'Which API version do we target?'},
					{question: 'Is a migration needed?'},
				],
			},
		},
	},
	{
		name: 'surface short-circuit',
		arg: `obs:${OBS}`,
		files: {[OBS_REL]: observation()},
		observationTriage: 'ask',
		rung: 'triage-observation',
		needsAgent: false,
		emits: {},
	},
	applyDecision('apply-decision task', 'Build a fix.', {
		outcome: 'task',
		taskSlug: 'fix-noisy-flake',
		taskTitle: 'Fix the noisy flake',
		taskBody:
			'## What to build\n\nMake the retry test deterministic.\n\n## Prompt\n\n> Fix the flake.\n',
	}),
	applyDecision('apply-decision spec', 'This needs a spec.', {
		outcome: 'spec',
		specSlug: 'deterministic-retries',
		specTitle: 'Deterministic retries',
		specBody: '## Problem Statement\n\nRetries flake.\n',
	}),
	applyDecision('apply-decision adr', 'Record the decision.', {
		outcome: 'adr',
		adrSlug: 'retries-are-bounded',
		adrTitle: 'Retries are bounded',
		adrBody: '## Context\n\nFlakes.\n\n## Decision\n\nBound retries.\n',
	}),
	applyDecision('apply-decision dispose', 'Already fixed.', {
		outcome: 'dispose',
		disposeReason: 'Fixed by the retry rewrite.',
	}),
	applyDecision('apply-decision resolve', 'Keep it as a standing note.', {
		outcome: 'resolve',
		resolveReason: 'A standing map of a known gap.',
	}),
	applyDecision('apply-decision ask', 'Maybe.', {
		outcome: 'ask',
		question: 'Which runner shows the flake?',
	}),
	{
		name: 'kind: stuck reset',
		arg: `task:${TASK}`,
		files: {
			[TASK_REL]: task(['needsAnswers: true']),
			[sidecarPathFor(TASK_ITEM)]: answeredSidecar(TASK_ITEM, [
				{
					question: `'${TASK_ITEM}' was bounced; how should we proceed?`,
					context: 'the gate failed',
					kind: 'stuck',
					answer: 'reset',
				},
			]),
		},
		branches: [`work/task-${TASK}`],
		rung: 'apply',
		needsAgent: false,
		emits: {},
	},
];

export function scenario(name: string): TreelessScenario {
	const s = SCENARIOS.find((x) => x.name === name);
	if (s === undefined) throw new Error(`no scenario ${name}`);
	return s;
}

/** Commit the scenario's files on `seeded.repo` and push them (and its branches) to the arbiter. */
export function seedScenario(seeded: SeededRepo, s: TreelessScenario): void {
	const g = (...args: string[]) => git(args, seeded.repo, {env: gitEnv()});
	for (const [rel, content] of Object.entries(s.files)) {
		const abs = join(seeded.repo, rel);
		mkdirSync(dirname(abs), {recursive: true});
		writeFileSync(abs, content);
	}
	g('add', '-A');
	g('commit', '-q', '-m', `seed ${s.name}`);
	g('push', '-q', 'arbiter', 'main');
	for (const branch of s.branches ?? []) {
		g('push', '-q', 'arbiter', `main:refs/heads/${branch}`);
	}
}
