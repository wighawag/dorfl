import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {
	advancePhasePath,
	performTreelessPhase,
	type TreelessPhaseOptions,
} from '../src/ci-phase-treeless.js';
import {defaultRungExecutor, type RungExecutor} from '../src/advance.js';
import {activateProcessPhase} from '../src/phase-recorder.js';
import type {LockOutputs} from '../src/ci-lock-outputs.js';
import type {GithubApiGet} from '../src/ci-agent-result.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {parseSidecar, sidecarPathFor} from '../src/sidecar.js';
import type {Phase} from '../src/phase.js';
import {git} from '../src/git.js';
import {
	ciPhaseEnv,
	isolatePiAgentDir,
	makeScratch,
	seedRepoWithArbiter,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';
import {
	OBS,
	OBS_REL,
	answeredSidecar,
	observation,
	scenario,
	seedScenario,
	type TreelessScenario,
} from './helpers/treeless-scenarios.js';

/**
 * The tree-less rungs split into the three CI phases (task
 * `ci-split-treeless-rungs`). The apply job treats the agent job's handoff as
 * HOSTILE: `readHandoff` checks the item, the intent kind for the rung, every
 * enum and every slug or item reference, and the apply phase adds what the
 * record format cannot know (a triage auto-disposition only under
 * `observationTriage: auto`, a target that is not the note itself). A rejected
 * handoff writes nothing from it and surfaces the item. These tests run each
 * phase in-process against a bare arbiter; the three-process runs, compared
 * with the laptop path, are `ci-phase-treeless-e2e.test.ts`.
 */

const ITEM = `observation:${OBS}`;
const OTHER_REL = 'work/notes/observations/other-note.md';

let scratch: Scratch;
let seeded: SeededRepo;
let runnerTemp: string;
let restorePi: () => void;

function g(cwd: string, ...args: string[]): string {
	return git(args, cwd, {env: ciPhaseEnv()}).trim();
}

function arbiterRefs(): string {
	return g(seeded.arbiter, 'for-each-ref', '--format=%(refname) %(objectname)');
}

function showOnArbiter(spec: string): string | undefined {
	try {
		return git(['show', spec], seeded.arbiter, {env: ciPhaseEnv()});
	} catch {
		return undefined;
	}
}

function lockRefOnArbiter(item = ITEM): string | undefined {
	const entry = item.replace(':', '-');
	const out = g(seeded.arbiter, 'for-each-ref', `refs/dorfl/lock/${entry}`);
	return out === '' ? undefined : out;
}

async function inPhase<T>(phase: Phase, fn: () => Promise<T>): Promise<T> {
	const restore = activateProcessPhase(phase);
	try {
		return await fn();
	} finally {
		restore();
	}
}

function base(
	phase: Phase,
	cwd: string,
	s: TreelessScenario,
	extra: Partial<TreelessPhaseOptions> = {},
): TreelessPhaseOptions {
	return {
		phase,
		arg: s.arg,
		cwd,
		arbiter: 'origin',
		observationTriage: s.observationTriage,
		publishJitterMs: 0,
		env: ciPhaseEnv(),
		...extra,
	};
}

async function lock(s: TreelessScenario): Promise<LockOutputs> {
	const r = await inPhase('lock', () =>
		performTreelessPhase(base('lock', seeded.clone('lock'), s)),
	);
	expect(r.outcome, r.message).toBe('locked');
	return r.lockOutputs!;
}

/** Write a raw `handoff.json` (bypassing the writer, as a hostile agent job could). */
function rawHandoff(record: Record<string, unknown>): void {
	const dir = join(runnerTemp, 'handoff');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, 'handoff.json'),
		JSON.stringify({schema: 1, item: ITEM, ...record}),
	);
}

async function apply(
	s: TreelessScenario,
	lockOutputs: LockOutputs,
	extra: Partial<TreelessPhaseOptions> = {},
) {
	return inPhase('apply', () =>
		performTreelessPhase(
			base('apply', seeded.clone('apply'), s, {
				lockOutputs,
				handoffDir: join(runnerTemp, 'handoff'),
				runnerTemp,
				agentResult: 'success',
				...extra,
			}),
		),
	);
}

/** The note was surfaced to needs-attention on main and the lock released. */
function expectNoteSurfaced(): void {
	const note = showOnArbiter(`main:${OBS_REL}`);
	expect(note, 'the note stays on main').toBeDefined();
	expect(parseFrontmatter(note as string).needsAnswers).toBe(true);
	const sidecar = showOnArbiter(`main:${sidecarPathFor(ITEM)}`) as string;
	expect(sidecar).toBeDefined();
	expect(parseSidecar(sidecar).entries.some((e) => e.kind === 'stuck')).toBe(
		true,
	);
	expect(lockRefOnArbiter()).toBeUndefined();
}

beforeEach(() => {
	scratch = makeScratch('dorfl-ci-phase-treeless-');
	restorePi = isolatePiAgentDir(scratch.root);
	seeded = seedRepoWithArbiter(scratch.root, []);
	runnerTemp = join(scratch.root, 'runner-temp');
	mkdirSync(runnerTemp);
});

afterEach(() => {
	restorePi();
	scratch.cleanup();
});

describe('apply: a hostile tree-less handoff (RED first)', () => {
	const decision = scenario('apply-decision task');
	const triage = scenario('triage auto-dispose under auto');

	/** Seed `s` plus an unrelated second note a hostile verdict could name. */
	function seed(s: TreelessScenario): void {
		seedScenario(seeded, {
			...s,
			files: {...s.files, [OTHER_REL]: observation()},
		});
	}

	it('an apply-decision naming another item is rejected and nothing from it lands', async () => {
		seed(decision);
		const held = await lock(decision);
		rawHandoff({
			item: 'observation:other-note',
			intent: {kind: 'apply-decision'},
			products: {outcome: 'dispose', reason: 'gone'},
		});
		const r = await apply(decision, held);
		expect(r.outcome, r.message).toBe('rejected');
		expect(r.exitCode).toBe(1);
		expect(showOnArbiter(`main:${OTHER_REL}`)).toBeDefined();
		expectNoteSurfaced();
	}, 60_000);

	it.each([
		['../../../evil-root', 'evil-root.md'],
		['../ready/evil', 'work/tasks/ready/evil.md'],
		['work/tasks/ready/evil', 'work/tasks/ready/work-tasks-ready-evil.md'],
	])(
		'an apply-decision minting at a path outside its own (%s) is rejected',
		async (slug, landedPath) => {
			seed(decision);
			const held = await lock(decision);
			rawHandoff({
				intent: {kind: 'apply-decision'},
				products: {
					outcome: 'task',
					slug,
					title: 'Evil',
					body: '## What to build\n\nx\n\n## Prompt\n\n> x\n',
				},
			});
			const r = await apply(decision, held);
			expect(r.outcome, r.message).toBe('rejected');
			expect(showOnArbiter(`main:${landedPath}`)).toBeUndefined();
			expect(showOnArbiter('main:work/tasks/ready/evil.md')).toBeUndefined();
			expect(
				showOnArbiter('main:work/tasks/ready/evil-root.md'),
			).toBeUndefined();
			expectNoteSurfaced();
		},
		60_000,
	);

	it('an apply-decision whose outcome is outside APPLY_ALLOWED_OUTCOMES is rejected', async () => {
		seed(decision);
		const held = await lock(decision);
		rawHandoff({
			intent: {kind: 'apply-decision'},
			products: {outcome: 'bounce', reason: 'not an apply outcome'},
		});
		const r = await apply(decision, held);
		expect(r.outcome, r.message).toBe('rejected');
		expectNoteSurfaced();
	}, 60_000);

	it.each([
		['promote', 'task:fix-the-flake'],
		['delete', 'task:fix-the-flake'],
	])(
		'a triage disposition outside its enum (%s) is rejected and the note stays',
		async (disposition, target) => {
			seedScenario(seeded, triage);
			const held = await lock(triage);
			rawHandoff({
				intent: {kind: 'triage'},
				products: {disposition, target},
			});
			const r = await apply(triage, held);
			expect(r.outcome, r.message).toBe('rejected');
			expect(showOnArbiter('main:work/tasks/ready/noisy-flake.md')).toBe(
				undefined,
			);
			expectNoteSurfaced();
		},
		60_000,
	);

	it('a triage target that is a path, not an item, is rejected', async () => {
		seedScenario(seeded, triage);
		const held = await lock(triage);
		rawHandoff({
			intent: {kind: 'triage'},
			products: {disposition: 'duplicate', target: '../../README.md'},
		});
		const r = await apply(triage, held);
		expect(r.outcome, r.message).toBe('rejected');
		expectNoteSurfaced();
	}, 60_000);

	it('a triage auto-disposition when observationTriage is not auto is rejected', async () => {
		const asked = scenario('triage fall-through to surface');
		seedScenario(seeded, asked);
		const held = await lock(asked);
		rawHandoff({
			intent: {kind: 'triage'},
			products: {
				disposition: 'duplicate',
				target: 'task:fix-the-flake',
				reason: 'dup',
			},
		});
		const r = await apply(asked, held);
		expect(r.outcome, r.message).toBe('rejected');
		expectNoteSurfaced();
	}, 60_000);

	it('an intent of another rung (a surface record on the apply rung) is rejected', async () => {
		seed(decision);
		const held = await lock(decision);
		rawHandoff({intent: {kind: 'surface'}, products: {questions: ['q?']}});
		const r = await apply(decision, held);
		expect(r.outcome, r.message).toBe('rejected');
		expectNoteSurfaced();
	}, 60_000);
});

describe('apply: the agent job did not succeed', () => {
	const s = scenario('apply-decision dispose');

	/** A stub Actions API: the agent job ran `minutes`, with no annotations. */
	function actionsApi(minutes: number): GithubApiGet {
		const start = Date.parse('2026-09-27T10:00:00Z');
		return async (url) => {
			if (url.includes('/jobs')) {
				return {
					status: 200,
					body: {
						jobs: [
							{
								id: 2,
								name: 'item / agent',
								started_at: new Date(start).toISOString(),
								completed_at: new Date(start + minutes * 60_000).toISOString(),
							},
						],
					},
				};
			}
			if (url.includes('/annotations')) return {status: 200, body: []};
			return {status: 404, body: {}};
		};
	}
	const actionsEnv = {
		...ciPhaseEnv(),
		GITHUB_REPOSITORY: 'o/r',
		GITHUB_RUN_ID: '77',
		GITHUB_RUN_ATTEMPT: '1',
	};

	it('failure surfaces the item without reading the handoff', async () => {
		seedScenario(seeded, s);
		const held = await lock(s);
		rawHandoff({
			intent: {kind: 'apply-decision'},
			products: {outcome: 'dispose', reason: 'would delete'},
		});
		const r = await apply(s, held, {agentResult: 'failure'});
		expect(r.outcome, r.message).toBe('surfaced');
		expectNoteSurfaced();
	}, 60_000);

	it('a timeout (cancelled at the time limit) surfaces the item', async () => {
		seedScenario(seeded, s);
		const held = await lock(s);
		const r = await apply(s, held, {
			agentResult: 'cancelled',
			agentTimeoutMinutes: 90,
			actionsApi: actionsApi(90),
			env: actionsEnv,
		});
		expect(r.outcome, r.message).toBe('surfaced');
		expectNoteSurfaced();
	}, 60_000);

	it('a real cancel only releases the advancing lock', async () => {
		seedScenario(seeded, s);
		const mainBefore = g(seeded.arbiter, 'rev-parse', 'main');
		const held = await lock(s);
		const r = await apply(s, held, {
			agentResult: 'cancelled',
			agentTimeoutMinutes: 90,
			actionsApi: actionsApi(3),
			env: actionsEnv,
		});
		expect(r.outcome, r.message).toBe('released');
		expect(lockRefOnArbiter()).toBeUndefined();
		expect(g(seeded.arbiter, 'rev-parse', 'main')).toBe(mainBefore);
	}, 60_000);

	it('an agent phase whose rung fails writes no handoff and fails', async () => {
		seedScenario(seeded, s);
		const held = await lock(s);
		const before = arbiterRefs();
		const handoffDir = join(runnerTemp, 'agent-out');
		const r = await inPhase('agent', () =>
			performTreelessPhase(
				base('agent', seeded.clone('agent'), s, {
					lockOutputs: held,
					handoffDir,
					applyDecide: async () => {
						throw new Error('model API overloaded');
					},
				}),
			),
		);
		expect(r.outcome, r.message).toBe('agent-failed');
		expect(r.exitCode).toBe(1);
		expect(arbiterRefs()).toBe(before);
	}, 60_000);
});

describe('apply: surfaced questions keep their shape', () => {
	it('an apply-decision ask with two questions surfaces two questions', async () => {
		const s = scenario('apply-decision ask');
		seedScenario(seeded, s);
		const held = await lock(s);
		rawHandoff({
			intent: {kind: 'apply-decision'},
			products: {
				outcome: 'ask',
				questions: ['Which runner shows the flake?', 'Since which commit?'],
			},
		});
		const r = await apply(s, held);
		expect(r.outcome, r.message).toBe('applied');
		const sidecar = parseSidecar(
			showOnArbiter(`main:${sidecarPathFor(ITEM)}`) as string,
		);
		expect(sidecar.entries.map((e) => [e.id, e.question])).toEqual([
			['q1', 'What should become of this observation?'],
			['q2', 'Which runner shows the flake?'],
			['q3', 'Since which commit?'],
		]);
		expect(lockRefOnArbiter()).toBeUndefined();
	}, 60_000);

	it('a surface question with an unknown key is rejected and nothing from it lands', async () => {
		const s = scenario('triage fall-through with context and default');
		seedScenario(seeded, s);
		const held = await lock(s);
		rawHandoff({
			intent: {kind: 'triage'},
			products: {
				disposition: 'keep',
				questions: [{question: 'Q?', kind: 'merge'}],
			},
		});
		const r = await apply(s, held);
		expect(r.outcome, r.message).toBe('rejected');
		expect(r.exitCode).toBe(1);
		const sidecar = parseSidecar(
			showOnArbiter(`main:${sidecarPathFor(ITEM)}`) as string,
		);
		expect(sidecar.entries.some((e) => e.question === 'Q?')).toBe(false);
		expectNoteSurfaced();
	}, 60_000);
});

describe('apply: the publish carries only the rung commit', () => {
	it('an apply checkout that carries an extra commit refuses the publish', async () => {
		const s = scenario('apply-decision resolve');
		seedScenario(seeded, s);
		const held = await lock(s);
		const mainBefore = g(seeded.arbiter, 'rev-parse', 'main');
		rawHandoff({
			intent: {kind: 'apply-decision'},
			products: {outcome: 'resolve', reason: 'keep it'},
		});
		// The rung commits its result on top of an unrelated extra commit (a
		// checkout not based on the fetched main would carry such commits).
		const executor: RungExecutor = {
			...defaultRungExecutor,
			async apply(input) {
				const cwd = input.context.cwd;
				writeFileSync(join(cwd, 'unreviewed.txt'), 'not the rung\n');
				g(cwd, 'add', 'unreviewed.txt');
				g(cwd, 'commit', '-q', '-m', 'an unreviewed commit');
				return defaultRungExecutor.apply(input);
			},
		};
		const r = await apply(s, held, {executor});
		expect(r.outcome, r.message).toBe('publish-refused');
		expect(r.exitCode).toBe(1);
		expect(g(seeded.arbiter, 'rev-parse', 'main')).toBe(mainBefore);
		expect(showOnArbiter('main:unreviewed.txt')).toBeUndefined();
		expect(lockRefOnArbiter()).toBeUndefined();
	}, 60_000);
});

describe('lock and stale-lock', () => {
	it('a pending sidecar is a no-op that takes no lock', async () => {
		const s: TreelessScenario = {
			...scenario('apply-decision resolve'),
			files: {
				[OBS_REL]: observation([], ['needsAnswers: true']),
				[sidecarPathFor(ITEM)]: answeredSidecar(ITEM, [
					{question: 'What now?', answer: ''},
				]),
			},
		};
		seedScenario(seeded, s);
		const before = arbiterRefs();
		const r = await inPhase('lock', () =>
			performTreelessPhase(base('lock', seeded.clone('lock'), s)),
		);
		expect(r.outcome, r.message).toBe('no-op');
		expect(r.lockOutputs?.acquired).toBe(false);
		expect(arbiterRefs()).toBe(before);
	}, 60_000);

	it('the apply phase writes nothing for a lock it no longer owns', async () => {
		const s = scenario('apply-decision dispose');
		seedScenario(seeded, s);
		const held = await lock(s);
		rawHandoff({
			intent: {kind: 'apply-decision'},
			products: {outcome: 'dispose', reason: 'gone'},
		});
		const before = arbiterRefs();
		const stale = await apply(s, {...held, lockSha: '0'.repeat(40)});
		expect(stale.outcome).toBe('stale-lock');
		expect(arbiterRefs()).toBe(before);
	}, 60_000);
});

describe('routing advance --phase', () => {
	it('classifies at the arbiter main in the lock phase and follows the rung output after', async () => {
		const s = scenario('surface with questions');
		seedScenario(seeded, s);
		const cwd = seeded.clone('route');
		expect(
			await advancePhasePath({
				phase: 'lock',
				arg: s.arg,
				cwd,
				env: ciPhaseEnv(),
			}),
		).toBe('treeless');
		expect(
			await advancePhasePath({
				phase: 'lock',
				arg: 'task:no-such-task-anywhere',
				cwd,
				env: ciPhaseEnv(),
			}),
		).toBe('build');
		expect(
			await advancePhasePath({
				phase: 'apply',
				arg: s.arg,
				cwd,
				lockOutputs: {acquired: true, rung: 'surface'},
			}),
		).toBe('treeless');
		expect(
			await advancePhasePath({
				phase: 'agent',
				arg: s.arg,
				cwd,
				lockOutputs: {acquired: true, rung: 'build-task'},
			}),
		).toBe('build');
	}, 60_000);
});
