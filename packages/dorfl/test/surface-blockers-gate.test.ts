import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	existsSync,
	rmSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	performAdvanceAuto,
	performAdvanceArgs,
	type AdvanceTickRunner,
} from '../src/advance-drivers.js';
import {performAdvance} from '../src/advance.js';
import type {AdvanceResult} from '../src/advance.js';
import type {LifecyclePoolGates} from '../src/lifecycle-pools.js';
import {buildLifecyclePools} from '../src/lifecycle-pools.js';
import {mergeConfig, type Config} from '../src/config.js';
import type {SurfaceGate, SurfaceEmit} from '../src/surface-gate.js';
import {newSidecar, serialiseSidecar, sidecarPathFor} from '../src/sidecar.js';
import {makeScratch, gitIn, type Scratch} from './helpers/gitRepo.js';
import type {
	AcquireAdvancingLockResult,
	ReleaseAdvancingLockResult,
} from '../src/advancing-lock.js';

/**
 * `surface-blockers-gate` task — the BOOLEAN `surfaceBlockers` gate (default
 * `off`) over DECLARED blocked work: whether a task/PRD carrying
 * `needsAnswers: true` is rendered into an answerable question sidecar (`on`) or
 * left silently blocked in the backlog (`off`). The orthogonal PEER of
 * `observationTriage` (the raw observation inbox). These tests pin the task's
 * contract:
 *
 *   1. the SELECTION layer (the `advance-autopick-lifecycle-pools` surface pool):
 *      `off` ⇒ the `needsAnswers`-blocked pool is NOT enumerated into auto-pick
 *      (the item is left silently blocked, no sidecar); `on` ⇒ the pool IS
 *      enumerated (an auto-picked blocked task/PRD dispatched to the surface
 *      rung). The cli wires `lifecycleGates.surface = config.surfaceBlockers`,
 *      modelled here by {@link surfaceGateFor} so the test asserts the ACTUAL rule.
 *   2. the always-on invariants the gate must NOT break: APPLY (consume an
 *      answered sidecar) still runs under `off` (never gated — the
 *      create-vs-consume invariant); `needs-attention` (a stuck build) is a
 *      SEPARATE always-on mechanism this gate does not touch; and an EXPLICIT
 *      `advance <slug>` / `advance prd:<slug>` BYPASSES the selection gate (the
 *      DECISION recorded in this task: explicit naming surfaces regardless,
 *      mirroring the other gates).
 *   3. the COMPOSE case (`observationTriage: ask` + `surfaceBlockers: off`): the
 *      two gates are orthogonal — groom the inbox, leave the blocked work alone —
 *      the previously-inexpressible corner.
 *
 * House style: plain checkouts the SELECTION layer only READS, a recording tick
 * runner for the selection assertions, and a real throwaway git repo + injected
 * lock/gate seams for the rung (surface) assertion. All shared/global locations
 * are temp fixtures.
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
 * contract: the `needsAnswers`-blocked (surface) pool is enumerated iff
 * `surfaceBlockers` is on. The triage pool is left OFF here (its `observationTriage`
 * gate is the orthogonal peer, exercised in the compose test).
 */
function surfaceGateFor(surfaceBlockers: boolean): LifecyclePoolGates {
	return {surface: surfaceBlockers};
}

describe('surfaceBlockers — the SELECTION-layer gate over the needsAnswers-blocked pool', () => {
	let root: string;
	let repo: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'dorfl-surface-blockers-gate-'));
		repo = join(root, 'project');
		mkdirSync(repo, {recursive: true});
	});
	afterEach(() => {
		rmSync(root, {recursive: true, force: true});
	});

	/** A `needsAnswers: true` task in `work/tasks/ready/` (a declared blocker, no sidecar). */
	function seedBlockedTask(slug: string): void {
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
				'a blocked task',
			].join('\n'),
		);
	}

	/** A `needsAnswers: true` PRD in `work/prds/ready/` (a declared blocker, no sidecar). */
	function seedBlockedPrd(slug: string): void {
		const dir = join(repo, 'work', 'prds', 'ready');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, `${slug}.md`),
			[
				'---',
				`slug: ${slug}`,
				'needsAnswers: true',
				'---',
				'',
				'a blocked prd',
			].join('\n'),
		);
	}

	/** An answered sidecar for `<namespace>:<slug>` (the APPLY/consume case). */
	function seedAnsweredSidecar(namespace: 'task' | 'prd', slug: string): void {
		const item = `${namespace}:${slug}`;
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

	function cfg(over: Partial<Config> = {}): Config {
		return mergeConfig({autoBuild: true, autoTask: true, ...over});
	}

	it('off ⇒ the needsAnswers-blocked pool is NOT enumerated (a bare advance picks NOTHING; no sidecar)', async () => {
		seedBlockedTask('blocked');
		const {run, args} = recordingRunner();
		const result = await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg({surfaceBlockers: false}),
			lifecycleGates: surfaceGateFor(false),
			count: 5,
		});
		expect(result.exitCode).toBe(0);
		// The declared blocker is left SILENTLY blocked: not auto-picked, no surface.
		expect(args).toEqual([]);
		// And the selection layer never created a sidecar (it never even ran a tick).
		expect(existsSync(join(repo, 'work', 'questions', 'task-blocked.md'))).toBe(
			false,
		);
	});

	it('on ⇒ the blocked TASK pool IS enumerated (auto-picked as the surface arg)', async () => {
		seedBlockedTask('blocked');
		const {run, args} = recordingRunner();
		await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg({surfaceBlockers: true}),
			lifecycleGates: surfaceGateFor(true),
			count: 5,
		});
		// A blocked TASK dispatches to the bare-slug surface arg (the tick classifies
		// it into the surface rung — needsAnswers, no all-answered sidecar).
		expect(args).toEqual(['blocked']);
	});

	it('on ⇒ a blocked PRD pool IS enumerated (auto-picked as prd:<slug>)', async () => {
		seedBlockedPrd('blocked-prd');
		const {run, args} = recordingRunner();
		await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg({surfaceBlockers: true}),
			lifecycleGates: surfaceGateFor(true),
			count: 5,
		});
		expect(args).toEqual(['prd:blocked-prd']);
	});

	it('APPLY is NOT gated: an answered blocker sidecar is auto-picked + applied EVEN under surfaceBlockers off', async () => {
		seedBlockedTask('answered');
		seedAnsweredSidecar('task', 'answered');
		const {run, args} = recordingRunner();
		const result = await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg({surfaceBlockers: false}),
			// surfaceBlockers off ⇒ surface (create) pool dropped; apply is NOT gated.
			lifecycleGates: surfaceGateFor(false),
			count: 5,
		});
		expect(result.exitCode).toBe(0);
		// The answered blocker is selected (apply/consume) regardless of the create-gate
		// — a human's committed answer is NEVER stranded (the create-vs-consume invariant).
		expect(args).toEqual(['answered']);
	});
});

describe('surfaceBlockers — explicit naming BYPASSES the selection gate (the recorded DECISION)', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('dorfl-surface-blockers-explicit-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	/** A throwaway repo with one `needsAnswers: true` task (a declared blocker, no sidecar). */
	function seedBlockedTask(slug: string): {repo: string; itemPath: string} {
		const repo = join(scratch.root, slug);
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		const itemPath = `work/tasks/ready/${slug}.md`;
		mkdirSync(join(repo, 'work', 'tasks', 'ready'), {recursive: true});
		writeFileSync(
			join(repo, itemPath),
			[
				'---',
				`slug: ${slug}`,
				'needsAnswers: true',
				'blockedBy: []',
				'---',
				'',
				'a blocked task',
				'',
			].join('\n'),
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed blocked task'], repo);
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

	/** A recording tick runner (no real tick fires — pins the SELECTION->dispatch). */
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

	it('explicit advance <slug> dispatches a declared blocker to the tick EVEN under surfaceBlockers off (the selection gate is bypassed)', async () => {
		const {repo} = seedBlockedTask('named');
		// `performAdvanceArgs` is the EXPLICIT-naming path: it dispatches the named item
		// VERBATIM, never consulting the lifecycle gates (the operator chose it). So the
		// blocker is dispatched even with surfaceBlockers off.
		const {run, args} = recordingRunner();
		const result = await performAdvanceArgs(['named'], {
			cwd: repo,
			run,
			config: mergeConfig({surfaceBlockers: false}),
		});
		expect(result.exitCode).toBe(0);
		expect(args).toEqual(['named']);
	});

	it('the single-tick surface rung runs on a named blocker regardless of the gate (performAdvance)', async () => {
		const {repo} = seedBlockedTask('direct');
		const {gate: surface, spawns} = spySurface({
			item: 'task:direct',
			questions: [{question: 'which approach?'}],
		});
		// The tick itself has no surfaceBlockers parameter — surface is ALWAYS allowed
		// on a named item; the gate lives ONLY at the selection layer.
		const result = await performAdvance({
			arg: 'direct',
			cwd: repo,
			surfaceGate: surface,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		expect(result.rung).toBe('surface');
		expect(spawns).toEqual(['task:direct']);
		expect(existsSync(join(repo, 'work', 'questions', 'task-direct.md'))).toBe(
			true,
		);
	});
});

describe('surfaceBlockers — the two gates compose orthogonally + apply/needs-attention stay always-on (unit)', () => {
	let root: string;
	let repo: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'dorfl-surface-blockers-compose-'));
		repo = join(root, 'project');
		mkdirSync(repo, {recursive: true});
	});
	afterEach(() => {
		rmSync(root, {recursive: true, force: true});
	});

	function seedObservation(slug: string): void {
		const dir = join(repo, 'work', 'notes', 'observations');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, `${slug}.md`),
			['---', `slug: ${slug}`, '---', '', 'a captured signal'].join('\n'),
		);
	}

	function seedBlockedTask(slug: string): void {
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
				'a blocked task',
			].join('\n'),
		);
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

	it('observationTriage: ask + surfaceBlockers: off ⇒ the observation surfaces but the blocked task does NOT (the previously-inexpressible corner)', async () => {
		seedObservation('stray');
		seedBlockedTask('blocked');
		const {run, args} = recordingRunner();
		// The exact cli wiring: triage = observationTriage !== 'off' (ask ⇒ true);
		// surface = surfaceBlockers (off ⇒ false). Groom the inbox, leave the blocked
		// work alone.
		const config = mergeConfig({
			autoBuild: true,
			autoTask: true,
			observationTriage: 'ask',
			surfaceBlockers: false,
		});
		await performAdvanceAuto({
			cwd: repo,
			run,
			config,
			lifecycleGates: {
				triage: config.observationTriage !== 'off',
				surface: config.surfaceBlockers,
			},
			count: 5,
		});
		// The untriaged observation IS surfaced (triage pool enumerated); the declared
		// blocker is NOT (surface pool dropped). The two gates compose orthogonally.
		expect(args).toEqual(['obs:stray']);
	});

	it('the surface gate filters ONLY the create (surface) pool — apply is always present, needs-attention is untouched (buildLifecyclePools)', () => {
		// surfaceBlockers off ⇒ a no-sidecar blocker drops from the surface pool, but
		// an ANSWERED blocker (apply/consume) is STILL enumerated. needs-attention is
		// not a lifecycle pool at all, so this gate cannot touch it (separate, always-on).
		const answered = newSidecar('task:answered', [{question: 'q?'}]);
		answered.entries[0].answer = 'yes';
		const offPools = buildLifecyclePools({
			repoPath: repo,
			observations: [],
			needsAnswers: [
				{
					repoPath: repo,
					namespace: 'task',
					slug: 'create-only',
					sidecar: undefined,
				},
				{
					repoPath: repo,
					namespace: 'task',
					slug: 'answered',
					sidecar: answered,
				},
			],
			gates: {surface: false},
		});
		// Create (surface) pool is empty under off; apply (consume) is ALWAYS present.
		expect(offPools.surface).toEqual([]);
		expect(offPools.apply.map((i) => i.slug)).toEqual(['answered']);

		// Flip surfaceBlockers on ⇒ the create-only blocker enters surface; apply
		// unchanged (the gate never touches consume).
		const onPools = buildLifecyclePools({
			repoPath: repo,
			observations: [],
			needsAnswers: [
				{
					repoPath: repo,
					namespace: 'task',
					slug: 'create-only',
					sidecar: undefined,
				},
				{
					repoPath: repo,
					namespace: 'task',
					slug: 'answered',
					sidecar: answered,
				},
			],
			gates: {surface: true},
		});
		expect(onPools.surface.map((i) => i.slug)).toEqual(['create-only']);
		expect(onPools.apply.map((i) => i.slug)).toEqual(['answered']);
	});
});
