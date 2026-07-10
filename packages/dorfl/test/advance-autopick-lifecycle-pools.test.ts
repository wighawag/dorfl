import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	performAdvanceAuto,
	type AdvanceTickRunner,
} from '../src/advance-drivers.js';
import {performDoAuto, type DoRunner} from '../src/do-autopick.js';
import type {AdvanceResult} from '../src/advance.js';
import type {DoResult} from '../src/do.js';
import {mergeConfig, type Config} from '../src/config.js';
import {
	newSidecar,
	serialiseSidecar,
	sidecarPathFor,
	sidecarPathCandidates,
} from '../src/sidecar.js';

/**
 * `advance-autopick-lifecycle-pools` (the in-place driver path) — the advance
 * auto-pick now ALSO enumerates the LIFECYCLE pools (untriaged observations +
 * `needsAnswers`-blocked tasks/PRDs + answered-sidecar items), not only the
 * build/task pools. House style mirrors `advance-drivers.test.ts`: a seeded
 * `work/` of tasks/PRDs/observations/sidecars in a plain checkout (the SELECTION
 * layer only READS `work/`), a STUBBED tick runner that records the `arg` it was
 * handed (so we assert WHICH item, dispatched to WHICH tick arg, in what ORDER).
 *
 * Proves the task's acceptance criteria: a bare `advance` auto-picks an untriaged
 * observation → `obs:<slug>` (triage); a `needsAnswers` task/PRD → surface; an
 * answered sidecar → apply (ALWAYS on); a `triaged:`-settled observation is NOT
 * re-picked; the INTERIM born-OFF default auto-triages/auto-surfaces NOTHING; and
 * `do` auto-pick is PROVABLY unchanged (never selects a lifecycle item).
 */

let root: string;
let repo: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'dorfl-lifecycle-pools-'));
	repo = join(root, 'project');
	mkdirSync(repo, {recursive: true});
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

function seedTask(
	slug: string,
	fm: {needsAnswers?: boolean; humanOnly?: boolean} = {},
): void {
	const dir = join(repo, 'work', 'tasks', 'ready');
	mkdirSync(dir, {recursive: true});
	const lines = ['---', `slug: ${slug}`];
	if (fm.humanOnly) lines.push('humanOnly: true');
	if (fm.needsAnswers) lines.push('needsAnswers: true');
	lines.push('blockedBy: []', '---', '', 'x');
	writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
}

function seedPrd(slug: string, fm: {needsAnswers?: boolean} = {}): void {
	const dir = join(repo, 'work', 'specs', 'ready');
	mkdirSync(dir, {recursive: true});
	const lines = ['---', `slug: ${slug}`];
	if (fm.needsAnswers) lines.push('needsAnswers: true');
	lines.push('---', '', '# PRD');
	writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
}

function seedObservation(slug: string, triaged?: string): void {
	const dir = join(repo, 'work', 'notes', 'observations');
	mkdirSync(dir, {recursive: true});
	const lines = ['---', `slug: ${slug}`];
	if (triaged !== undefined) lines.push(`triaged: ${triaged}`);
	lines.push('---', '', 'a captured signal');
	writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
}

/**
 * Write the identity-keyed sidecar for a `task`/`spec` item, answered or pending.
 * `'prd'` is a special SEEDER mode: it writes the item as `spec:<slug>` but at the
 * LEGACY on-disk `prd-<slug>.md` fallback path (CARVE-OUT #1) to prove the reader
 * still finds a `spec:`-emitted item's not-yet-renamed legacy sidecar.
 */
function seedSidecar(
	namespace: 'task' | 'prd' | 'spec',
	slug: string,
	answered: boolean,
): void {
	const legacyPrd = namespace === 'prd';
	const item = `${legacyPrd ? 'spec' : namespace}:${slug}`;
	const model = newSidecar(item, [{question: 'pick one?'}]);
	if (answered) {
		model.entries[0].answer = 'yes';
	}
	// A `'prd'`-mode seed writes the legacy `prd-<slug>.md` fallback (2nd
	// candidate); otherwise the canonical path (1st candidate).
	const rel = legacyPrd ? sidecarPathCandidates(item)[1] : sidecarPathFor(item);
	const abs = join(repo, rel);
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

/** The internal hook the gate tasks will wire to config: force the create-gates on. */
const FORCE_ON = {triage: true, surface: true};

describe('advance auto-pick — untriaged observations → triage (obs:<slug>)', () => {
	it('with the triage gate forced ON, auto-picks an untriaged observation as obs:<slug>', async () => {
		seedObservation('stray');
		const {run, args} = recordingRunner();
		const result = await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg(),
			lifecycleGates: FORCE_ON,
			count: 5,
		});
		expect(result.exitCode).toBe(0);
		expect(args).toEqual(['obs:stray']);
	});

	it('a `triaged:`-SETTLED observation is NOT re-picked (drops out of the pool)', async () => {
		seedObservation('settled-keep', 'keep');
		seedObservation('settled-dup', 'duplicate');
		seedObservation('open');
		const {run, args} = recordingRunner();
		await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg(),
			lifecycleGates: FORCE_ON,
			count: 5,
		});
		// Only the untriaged one is selected.
		expect(args).toEqual(['obs:open']);
	});
});

describe('advance auto-pick — needsAnswers-blocked items → surface', () => {
	it('with the surface gate forced ON, auto-picks a needsAnswers task (no sidecar) → surface arg', async () => {
		seedTask('blocked-task', {needsAnswers: true});
		const {run, args} = recordingRunner();
		await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg(),
			lifecycleGates: FORCE_ON,
			count: 5,
		});
		// the tick re-classifies a needsAnswers task (no sidecar) → surface rung.
		expect(args).toEqual(['blocked-task']);
	});

	it('a needsAnswers PRD (no sidecar) → surface arg (spec:<slug>)', async () => {
		seedPrd('blocked-prd', {needsAnswers: true});
		const {run, args} = recordingRunner();
		await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg(),
			lifecycleGates: FORCE_ON,
			count: 5,
		});
		expect(args).toEqual(['spec:blocked-prd']);
	});

	it('a PENDING-sidecar blocked item is NOT selected (calm, no thrash)', async () => {
		seedTask('half', {needsAnswers: true});
		seedSidecar('task', 'half', false); // pending
		const {run, args} = recordingRunner();
		await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg(),
			lifecycleGates: FORCE_ON,
			count: 5,
		});
		expect(args).toEqual([]);
	});
});

describe('advance auto-pick — answered-sidecar items → apply (ALWAYS on)', () => {
	it('an answered sidecar is auto-picked + dispatched to apply EVEN with both create-gates OFF (consume)', async () => {
		seedTask('answered', {needsAnswers: true});
		seedSidecar('task', 'answered', true);
		const {run, args} = recordingRunner();
		const result = await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg(),
			// NO lifecycleGates → create-gates OFF (interim default). Apply still runs.
			count: 5,
		});
		expect(result.exitCode).toBe(0);
		expect(args).toEqual(['answered']);
	});

	it('an answered PRD sidecar → apply (spec:<slug>), gates off', async () => {
		seedPrd('answered-prd', {needsAnswers: true});
		// LEGACY on-disk `prd-answered-prd.md` sidecar; the producer emits
		// `spec:answered-prd`, so the reader's fallback resolves it (proof the
		// legacy sidecar filename is still found for a `spec:`-emitted item).
		seedSidecar('prd', 'answered-prd', true);
		const {run, args} = recordingRunner();
		await performAdvanceAuto({cwd: repo, run, config: cfg(), count: 5});
		expect(args).toEqual(['spec:answered-prd']);
	});
});

describe('advance auto-pick — INTERIM born-OFF default is CALM (F-INTERIM)', () => {
	it('with NO gate wired (default), auto-triages/auto-surfaces NOTHING', async () => {
		seedObservation('untriaged');
		seedTask('blocked', {needsAnswers: true}); // no sidecar → would-be surface
		const {run, args} = recordingRunner();
		const result = await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg(),
			count: 5,
		});
		// the create-side lifecycle pools contribute NOTHING by default.
		expect(args).toEqual([]);
		expect(result.exitCode).toBe(0);
	});

	it('the five-pool ORDER: apply PINNED first, then the drain order (build → task → surface → triage)', async () => {
		// buildable
		seedTask('build-me');
		seedPrd('task-me');
		// lifecycle
		seedObservation('triage-me'); // triage
		seedTask('surface-me', {needsAnswers: true}); // surface (no sidecar)
		seedTask('apply-me', {needsAnswers: true});
		seedSidecar('task', 'apply-me', true); // apply (answered)
		const {run, args} = recordingRunner();
		await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg(),
			lifecycleGates: FORCE_ON,
			count: 99,
		});
		expect(args).toEqual([
			'apply-me', // apply: PINNED FIRST (consume-always-wins)
			'build-me', // build: eligible task
			'spec:task-me', // task: taskable PRD
			'surface-me', // surface
			'obs:triage-me', // triage
		]);
	});
});

describe('do auto-pick is PROVABLY UNCHANGED (F-SHARE)', () => {
	function doRunner(): {run: DoRunner; args: string[]} {
		const args: string[] = [];
		const run: DoRunner = async (options) => {
			args.push(options.arg);
			return {
				exitCode: 0,
				outcome: 'completed',
				message: `did ${options.arg}`,
			} satisfies DoResult;
		};
		return {run, args};
	}

	it('do auto-pick / -n NEVER selects an observation or a needsAnswers item', async () => {
		// A `work/` full of lifecycle items + ONE eligible task + ONE taskable PRD.
		seedTask('build-me');
		seedPrd('task-me');
		seedObservation('untriaged');
		seedTask('blocked-task', {needsAnswers: true});
		seedPrd('blocked-prd', {needsAnswers: true});
		seedTask('answered', {needsAnswers: true});
		seedSidecar('task', 'answered', true);

		const {run, args} = doRunner();
		await performDoAuto({cwd: repo, run, config: cfg(), count: 99});
		// `do` passes NO lifecycle pools → selects ONLY the eligible task + PRD.
		expect(args).toEqual(['build-me', 'spec:task-me']);
		expect(args.some((a) => a.startsWith('obs:'))).toBe(false);
	});
});
