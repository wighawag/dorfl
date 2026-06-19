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
import {newSidecar, serialiseSidecar, sidecarPathFor} from '../src/sidecar.js';

/**
 * `advance-autopick-lifecycle-pools` (the in-place driver path) — the advance
 * auto-pick now ALSO enumerates the LIFECYCLE pools (untriaged observations +
 * `needsAnswers`-blocked slices/PRDs + answered-sidecar items), not only the
 * build/slice pools. House style mirrors `advance-drivers.test.ts`: a seeded
 * `work/` of slices/PRDs/observations/sidecars in a plain checkout (the SELECTION
 * layer only READS `work/`), a STUBBED tick runner that records the `arg` it was
 * handed (so we assert WHICH item, dispatched to WHICH tick arg, in what ORDER).
 *
 * Proves the slice's acceptance criteria: a bare `advance` auto-picks an untriaged
 * observation → `obs:<slug>` (triage); a `needsAnswers` slice/PRD → surface; an
 * answered sidecar → apply (ALWAYS on); a `triaged:`-settled observation is NOT
 * re-picked; the INTERIM born-OFF default auto-triages/auto-surfaces NOTHING; and
 * `do` auto-pick is PROVABLY unchanged (never selects a lifecycle item).
 */

let root: string;
let repo: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'agent-runner-lifecycle-pools-'));
	repo = join(root, 'project');
	mkdirSync(repo, {recursive: true});
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

function seedSlice(
	slug: string,
	fm: {needsAnswers?: boolean; humanOnly?: boolean} = {},
): void {
	const dir = join(repo, 'work', 'tasks', 'todo');
	mkdirSync(dir, {recursive: true});
	const lines = ['---', `slug: ${slug}`];
	if (fm.humanOnly) lines.push('humanOnly: true');
	if (fm.needsAnswers) lines.push('needsAnswers: true');
	lines.push('blockedBy: []', '---', '', 'x');
	writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
}

function seedPrd(slug: string, fm: {needsAnswers?: boolean} = {}): void {
	const dir = join(repo, 'work', 'briefs', 'ready');
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

/** Write the identity-keyed sidecar for `<namespace>:<slug>`, answered or pending. */
function seedSidecar(
	namespace: 'slice' | 'prd',
	slug: string,
	answered: boolean,
): void {
	const item = `${namespace}:${slug}`;
	const model = newSidecar(item, [{question: 'pick one?'}]);
	if (answered) {
		model.entries[0].answer = 'yes';
	}
	const rel = sidecarPathFor(item);
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
	return mergeConfig({autoBuild: true, autoSlice: true, ...over});
}

/** The internal hook the gate slices will wire to config: force the create-gates on. */
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
	it('with the surface gate forced ON, auto-picks a needsAnswers slice (no sidecar) → surface arg', async () => {
		seedSlice('blocked-slice', {needsAnswers: true});
		const {run, args} = recordingRunner();
		await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg(),
			lifecycleGates: FORCE_ON,
			count: 5,
		});
		// the tick re-classifies a needsAnswers slice (no sidecar) → surface rung.
		expect(args).toEqual(['blocked-slice']);
	});

	it('a needsAnswers PRD (no sidecar) → surface arg (prd:<slug>)', async () => {
		seedPrd('blocked-prd', {needsAnswers: true});
		const {run, args} = recordingRunner();
		await performAdvanceAuto({
			cwd: repo,
			run,
			config: cfg(),
			lifecycleGates: FORCE_ON,
			count: 5,
		});
		expect(args).toEqual(['prd:blocked-prd']);
	});

	it('a PENDING-sidecar blocked item is NOT selected (calm, no thrash)', async () => {
		seedSlice('half', {needsAnswers: true});
		seedSidecar('slice', 'half', false); // pending
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
		seedSlice('answered', {needsAnswers: true});
		seedSidecar('slice', 'answered', true);
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

	it('an answered PRD sidecar → apply (prd:<slug>), gates off', async () => {
		seedPrd('answered-prd', {needsAnswers: true});
		seedSidecar('prd', 'answered-prd', true);
		const {run, args} = recordingRunner();
		await performAdvanceAuto({cwd: repo, run, config: cfg(), count: 5});
		expect(args).toEqual(['prd:answered-prd']);
	});
});

describe('advance auto-pick — INTERIM born-OFF default is CALM (F-INTERIM)', () => {
	it('with NO gate wired (default), auto-triages/auto-surfaces NOTHING', async () => {
		seedObservation('untriaged');
		seedSlice('blocked', {needsAnswers: true}); // no sidecar → would-be surface
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

	it('the five-pool ORDER: apply PINNED first, then the drain order (build → slice → surface → triage)', async () => {
		// buildable
		seedSlice('build-me');
		seedPrd('slice-me');
		// lifecycle
		seedObservation('triage-me'); // triage
		seedSlice('surface-me', {needsAnswers: true}); // surface (no sidecar)
		seedSlice('apply-me', {needsAnswers: true});
		seedSidecar('slice', 'apply-me', true); // apply (answered)
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
			'build-me', // build: eligible slice
			'prd:slice-me', // slice: sliceable PRD
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
		// A `work/` full of lifecycle items + ONE eligible slice + ONE sliceable PRD.
		seedSlice('build-me');
		seedPrd('slice-me');
		seedObservation('untriaged');
		seedSlice('blocked-slice', {needsAnswers: true});
		seedPrd('blocked-prd', {needsAnswers: true});
		seedSlice('answered', {needsAnswers: true});
		seedSidecar('slice', 'answered', true);

		const {run, args} = doRunner();
		await performDoAuto({cwd: repo, run, config: cfg(), count: 99});
		// `do` passes NO lifecycle pools → selects ONLY the eligible slice + PRD.
		expect(args).toEqual(['build-me', 'prd:slice-me']);
		expect(args.some((a) => a.startsWith('obs:'))).toBe(false);
	});
});
