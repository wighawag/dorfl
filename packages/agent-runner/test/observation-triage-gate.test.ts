import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	existsSync,
	rmSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	performAdvanceAuto,
	type AdvanceTickRunner,
} from '../src/advance-drivers.js';
import {performAdvance} from '../src/advance.js';
import type {AdvanceResult} from '../src/advance.js';
import type {LifecyclePoolGates} from '../src/lifecycle-pools.js';
import {
	mergeConfig,
	type Config,
	type ObservationTriage,
} from '../src/config.js';
import type {TriageGate, TriageEmit} from '../src/triage-gate.js';
import type {SurfaceGate, SurfaceEmit} from '../src/surface-gate.js';
import type {
	AutoDispositionOptions,
	AutoDispositionResult,
} from '../src/triage-persist.js';
import {newSidecar, serialiseSidecar, sidecarPathFor} from '../src/sidecar.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {makeScratch, gitIn, type Scratch} from './helpers/gitRepo.js';
import type {
	AcquireAdvancingLockResult,
	ReleaseAdvancingLockResult,
} from '../src/advancing-lock.js';

/**
 * `observation-triage-tri-state-gate` task — the `autoTriage` boolean is REPLACED
 * by the 3-state `observationTriage` (`off | ask | auto`) gate. These tests pin
 * the task's contract at the TWO layers it touches:
 *
 *   1. the SELECTION layer (the `advance-autopick-lifecycle-pools` observation
 *      pool): `off` ⇒ the observation pool is NOT enumerated into auto-pick (the
 *      observation is left untouched, no sidecar); `ask`/`auto` ⇒ the pool IS
 *      enumerated (an untriaged observation is auto-picked as `obs:<slug>`). The
 *      cli wires `lifecycleGates.triage = observationTriage !== 'off'`, modelled
 *      here by {@link triageGateFor} so the test asserts the ACTUAL rule;
 *   2. the RUNG layer (ask-vs-auto): `auto` runs the conservative auto-disposition
 *      exception (duplicate/map auto-disposed + a question for the rest), `ask`
 *      (and `off` + an explicit `obs:` that bypassed the selection gate) surfaces
 *      the question.
 *
 * Plus the two always-on invariants the gate must NOT break: an explicit
 * `advance obs:<slug>` BYPASSES the selection gate (runs even under `off`, in
 * `ask`-mode), and an answered sidecar still APPLIES under `off` (consume is never
 * gated — the create-vs-consume invariant).
 *
 * House style: plain checkouts the SELECTION layer only READS (lifecycle-pools
 * tests), a recording tick runner for the selection assertions, and real
 * throwaway git repos + injected lock/gate seams for the rung assertions
 * (advance-triage tests). All shared/global locations are temp fixtures.
 */

const ACQUIRED: AcquireAdvancingLockResult = {
	exitCode: 0,
	outcome: 'acquired',
	message: 'locked',
};
const RELEASED: ReleaseAdvancingLockResult = {
	exitCode: 0,
	outcome: 'released',
	message: 'released',
};

/**
 * The cli's SELECTION-layer wiring rule, modelled so the test asserts the actual
 * contract: the observation (triage) pool is enumerated iff `observationTriage`
 * is not `off`. (`surface` stays born-OFF — its gate is a sibling task.)
 */
function triageGateFor(mode: ObservationTriage): LifecyclePoolGates {
	return {triage: mode !== 'off'};
}

describe('observationTriage — the SELECTION-layer gate over the observation pool', () => {
	let root: string;
	let repo: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'agent-runner-obs-triage-gate-'));
		repo = join(root, 'project');
		mkdirSync(repo, {recursive: true});
	});
	afterEach(() => {
		rmSync(root, {recursive: true, force: true});
	});

	function seedObservation(slug: string, triaged?: string): void {
		const dir = join(repo, 'work', 'notes', 'observations');
		mkdirSync(dir, {recursive: true});
		const lines = ['---', `slug: ${slug}`];
		if (triaged !== undefined) lines.push(`triaged: ${triaged}`);
		lines.push('---', '', 'a captured signal');
		writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
	}

	function recordingRunner(): {run: AdvanceTickRunner; args: string[]} {
		const args: string[] = [];
		const run: AdvanceTickRunner = async (options) => {
			args.push(options.arg);
			return {
				exitCode: 0,
				outcome: 'advanced',
				slug: options.arg,
				message: `advanced ${options.arg}`,
			} satisfies AdvanceResult;
		};
		return {run, args};
	}

	function cfg(over: Partial<Config> = {}): Config {
		return mergeConfig({autoBuild: true, autoTask: true, ...over});
	}

	it('off ⇒ the observation pool is NOT enumerated (a bare advance picks NOTHING)', async () => {
		seedObservation('stray');
		const {run, args} = recordingRunner();
		const result = await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg(),
			lifecycleGates: triageGateFor('off'),
			count: 5,
		});
		expect(result.exitCode).toBe(0);
		// The untriaged observation is left untouched (not auto-picked, no sidecar).
		expect(args).toEqual([]);
	});

	it('ask ⇒ the observation pool IS enumerated (auto-picked as obs:<slug>)', async () => {
		seedObservation('stray');
		const {run, args} = recordingRunner();
		await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg({observationTriage: 'ask'}),
			lifecycleGates: triageGateFor('ask'),
			count: 5,
		});
		expect(args).toEqual(['obs:stray']);
	});

	it('auto ⇒ the observation pool IS enumerated (auto-picked as obs:<slug>)', async () => {
		seedObservation('stray');
		const {run, args} = recordingRunner();
		await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg({observationTriage: 'auto'}),
			lifecycleGates: triageGateFor('auto'),
			count: 5,
		});
		expect(args).toEqual(['obs:stray']);
	});
});

describe('observationTriage — the RUNG-layer ask-vs-auto distinction + always-on invariants', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('agent-runner-obs-triage-rung-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	/** A throwaway repo with one UNTRIAGED observation (no needsAnswers, no sidecar). */
	function seedObservation(slug: string): {repo: string; itemPath: string} {
		const repo = join(scratch.root, slug);
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		const itemPath = `work/notes/observations/${slug}.md`;
		mkdirSync(join(repo, 'work', 'notes', 'observations'), {recursive: true});
		writeFileSync(
			join(repo, itemPath),
			[
				'---',
				`title: ${slug}`,
				'date: 2026-06-13',
				'---',
				'',
				'a signal',
				'',
			].join('\n'),
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed observation'], repo);
		return {repo, itemPath};
	}

	/** A surface-gate stub recording the spawn + returning a canned emit. */
	function spySurface(emit: SurfaceEmit): {
		gate: SurfaceGate;
		spawns: string[];
	} {
		const spawns: string[] = [];
		const gate: SurfaceGate = async (input) => {
			spawns.push(input.item);
			return emit;
		};
		return {gate, spawns};
	}

	/** A triage-gate stub recording the spawn + returning a canned emit. */
	function spyTriage(emit: TriageEmit): {gate: TriageGate; spawns: string[]} {
		const spawns: string[] = [];
		const gate: TriageGate = async (input) => {
			spawns.push(input.item);
			return emit;
		};
		return {gate, spawns};
	}

	it('auto + a DUPLICATE ⇒ auto-disposes WITHOUT a question (the old autoTriage:true)', async () => {
		const {repo, itemPath} = seedObservation('dup');
		const {gate: triage, spawns} = spyTriage({
			auto: true,
			kind: 'duplicate',
			existing: 'observation:original',
			reason: 'same signal',
		});
		const {gate: surface, spawns: surfaceSpawns} = spySurface({
			item: 'observation:dup',
			questions: [{question: 'q?'}],
		});
		const result = await performAdvance({
			arg: 'obs:dup',
			cwd: repo,
			observationTriage: 'auto',
			triageGate: triage,
			surfaceGate: surface,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		// The triage gate WAS consulted; NO question surfaced (auto path).
		expect(spawns).toEqual(['observation:dup']);
		expect(surfaceSpawns).toEqual([]);
		expect(
			existsSync(join(repo, 'work', 'questions', 'observation-dup.md')),
		).toBe(false);
		// Recommend-delete + triaged:duplicate marker (the agent never auto-deletes).
		const body = readFileSync(join(repo, itemPath), 'utf8');
		expect(/^triaged:\s*duplicate/m.test(body)).toBe(true);
	});

	it('ask ⇒ surfaces the question, NEVER consults the triage gate (the old autoTriage:false)', async () => {
		const {repo, itemPath} = seedObservation('asky');
		const {gate: surface, spawns} = spySurface({
			item: 'observation:asky',
			questions: [{question: 'Promote, keep, or delete?', disposition: 'keep'}],
		});
		const {gate: triage, spawns: triageSpawns} = spyTriage({
			auto: true,
			kind: 'duplicate',
			existing: 'observation:other',
			reason: 'x',
		});
		const result = await performAdvance({
			arg: 'obs:asky',
			cwd: repo,
			observationTriage: 'ask',
			surfaceGate: surface,
			triageGate: triage,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		// The triage (auto-disposition) gate is NEVER asked under `ask`.
		expect(triageSpawns).toEqual([]);
		// The question WAS surfaced (engine persisted the sidecar + needsAnswers).
		expect(spawns).toEqual(['observation:asky']);
		expect(
			existsSync(join(repo, 'work', 'questions', 'observation-asky.md')),
		).toBe(true);
		expect(
			parseFrontmatter(readFileSync(join(repo, itemPath), 'utf8')).needsAnswers,
		).toBe(true);
	});

	it('explicit obs:<slug> BYPASSES the selection gate AND runs in ask-mode under off (surfaces a question, no auto-disposition)', async () => {
		const {repo} = seedObservation('explicit');
		const {gate: surface, spawns} = spySurface({
			item: 'observation:explicit',
			questions: [{question: 'promote/keep/delete?', disposition: 'keep'}],
		});
		// A triage gate is provided but MUST NOT be consulted (off ≠ auto-mode).
		const {gate: triage, spawns: triageSpawns} = spyTriage({
			auto: true,
			kind: 'duplicate',
			existing: 'observation:other',
			reason: 'x',
		});
		const result = await performAdvance({
			arg: 'obs:explicit',
			cwd: repo,
			// `off`: the selection gate would DROP this from auto-pick — but an
			// EXPLICIT name bypasses the selection gate and the rung still runs.
			observationTriage: 'off',
			surfaceGate: surface,
			triageGate: triage,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		expect(result.rung).toBe('triage-observation');
		// Ran in the conservative `ask`-mode: question surfaced, gate NOT consulted.
		expect(triageSpawns).toEqual([]);
		expect(spawns).toEqual(['observation:explicit']);
		expect(
			existsSync(join(repo, 'work', 'questions', 'observation-explicit.md')),
		).toBe(true);
	});

	it('the auto-disposition seam is honoured (auto + map records the disposition, no question)', async () => {
		const {repo} = seedObservation('mapped');
		const {gate: triage} = spyTriage({
			auto: true,
			kind: 'map',
			existing: 'task:existing-thing',
			reason: 'covered by an existing task',
		});
		const disposed: AutoDispositionOptions[] = [];
		const dispose = (
			options: AutoDispositionOptions,
		): AutoDispositionResult => {
			disposed.push(options);
			return {
				outcome: 'kept',
				commit: 'deadbeef',
				itemPath: options.itemPath,
				message: `auto-disposed ${options.item}`,
			};
		};
		const result = await performAdvance({
			arg: 'obs:mapped',
			cwd: repo,
			observationTriage: 'auto',
			triageGate: triage,
			autoDisposition: dispose,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		expect(disposed).toHaveLength(1);
		expect(disposed[0].kind).toBe('map');
		expect(disposed[0].existing).toBe('task:existing-thing');
	});
});

describe('observationTriage — apply is NOT gated (consume always runs, even under off)', () => {
	let root: string;
	let repo: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'agent-runner-obs-triage-apply-'));
		repo = join(root, 'project');
		mkdirSync(repo, {recursive: true});
	});
	afterEach(() => {
		rmSync(root, {recursive: true, force: true});
	});

	function seedTask(slug: string): void {
		const dir = join(repo, 'work', 'tasks', 'ready');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, `${slug}.md`),
			[
				'---',
				`slug: ${slug}`,
				'needsAnswers: true',
				'blockedBy: []',
				'---',
				'',
				'x',
			].join('\n'),
		);
	}

	function seedAnsweredSidecar(slug: string): void {
		const item = `task:${slug}`;
		const model = newSidecar(item, [{question: 'pick one?'}]);
		model.entries[0].answer = 'yes';
		const abs = join(repo, sidecarPathFor(item));
		mkdirSync(join(abs, '..'), {recursive: true});
		writeFileSync(abs, serialiseSidecar(model));
	}

	function recordingRunner(): {run: AdvanceTickRunner; args: string[]} {
		const args: string[] = [];
		const run: AdvanceTickRunner = async (options) => {
			args.push(options.arg);
			return {
				exitCode: 0,
				outcome: 'advanced',
				slug: options.arg,
				message: `advanced ${options.arg}`,
			} satisfies AdvanceResult;
		};
		return {run, args};
	}

	it('an answered sidecar is auto-picked + dispatched to apply EVEN with observationTriage off', async () => {
		seedTask('answered');
		seedAnsweredSidecar('answered');
		const {run, args} = recordingRunner();
		const result = await performAdvanceAuto({
			cwd: repo,
			run,
			config: mergeConfig({
				autoBuild: true,
				autoTask: true,
				observationTriage: 'off',
			}),
			// observationTriage off ⇒ triage pool dropped; apply is NOT gated.
			lifecycleGates: {triage: false},
			count: 5,
		});
		expect(result.exitCode).toBe(0);
		// The answered task is selected (apply) regardless of the create-gate.
		expect(args).toEqual(['answered']);
	});
});
