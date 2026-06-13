import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {scanMirrorPool} from '../src/mirror-pool-scan.js';
import {gatherLifecycleInPlace} from '../src/lifecycle-gather.js';
import {selectPrioritised} from '../src/select-priority.js';
import {mergeConfig} from '../src/config.js';
import {newSidecar, serialiseSidecar} from '../src/sidecar.js';
import {
	makeScratch,
	registerMirrorWithWork,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `advance-autopick-lifecycle-pools` (the MIRROR-SIDE path) — the lifecycle pools
 * are enumerated from a BARE hub mirror's committed `main` through the SAME shared
 * unit the in-place caller uses, so the loop/CI advance reaches triage/surface/
 * apply autonomously and the in-place + mirror-side selections AGREE.
 *
 * House `--bare`-mirror style (`mirror-pool-scan.test.ts`): seed a bare mirror with
 * observations + needsAnswers items + committed sidecars, then assert the
 * mirror-side `scanMirrorPool().lifecycle` equals the in-place
 * `gatherLifecycleInPlace` over the SAME logical `work/` state.
 */

let scratch: Scratch;
let ws: string;

beforeEach(() => {
	scratch = makeScratch('agent-runner-lifecycle-mirror-');
	ws = join(scratch.root, '.agent-runner');
});

afterEach(() => {
	scratch.cleanup();
});

function slice(fm: Record<string, string>): string {
	const lines = ['---'];
	for (const [k, v] of Object.entries(fm)) lines.push(`${k}: ${v}`);
	lines.push('---', '', 'body');
	return lines.join('\n');
}

function prd(fm: Record<string, string>): string {
	const lines = ['---'];
	for (const [k, v] of Object.entries(fm)) lines.push(`${k}: ${v}`);
	lines.push('---', '', '# PRD');
	return lines.join('\n');
}

function obs(fm: Record<string, string>): string {
	const lines = ['---'];
	for (const [k, v] of Object.entries(fm)) lines.push(`${k}: ${v}`);
	lines.push('---', '', 'a signal');
	return lines.join('\n');
}

function sidecar(item: string, answered: boolean): string {
	const model = newSidecar(item, [{question: 'pick?'}]);
	if (answered) model.entries[0].answer = 'yes';
	return serialiseSidecar(model);
}

/** The logical `work/` tree used by both substrates in the agreement test. */
const WORK = {
	backlog: {
		'blocked-slice.md': slice({slug: 'blocked-slice', needsAnswers: 'true'}),
		'answered-slice.md': slice({slug: 'answered-slice', needsAnswers: 'true'}),
		'half-slice.md': slice({slug: 'half-slice', needsAnswers: 'true'}),
	},
	prd: {
		'answered-prd.md': prd({slug: 'answered-prd', needsAnswers: 'true'}),
	},
	observations: {
		'open.md': obs({slug: 'open'}),
		'settled.md': obs({slug: 'settled', triaged: 'keep'}),
	},
	questions: {
		'slice-answered-slice.md': sidecar('slice:answered-slice', true),
		'slice-half-slice.md': sidecar('slice:half-slice', false), // pending
		'prd-answered-prd.md': sidecar('prd:answered-prd', true),
	},
};

describe('scanMirrorPool — enumerates the LIFECYCLE pools from a bare mirror main', () => {
	it('with create-gates ON: triage = untriaged obs, surface = blocked-no-sidecar, apply = answered sidecars', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', WORK);
		const result = await scanMirrorPool({
			mirrorPath,
			config: mergeConfig({autoBuild: true, autoSlice: true}),
			lifecycleGates: {triage: true, surface: true},
			env: gitEnv(),
		});
		expect(result.lifecycle.triage.map((s) => s.slug)).toEqual(['open']);
		expect(result.lifecycle.surface.map((s) => s.slug)).toEqual([
			'blocked-slice',
		]);
		expect(
			result.lifecycle.apply.map((s) => `${s.namespace}:${s.slug}`).sort(),
		).toEqual(['prd:answered-prd', 'slice:answered-slice']);
	});

	it('INTERIM born-OFF default: triage + surface EMPTY, apply still present (consume always-on)', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', WORK);
		const result = await scanMirrorPool({
			mirrorPath,
			config: mergeConfig({autoBuild: true, autoSlice: true}),
			// no lifecycleGates → create-gates OFF.
			env: gitEnv(),
		});
		expect(result.lifecycle.triage).toEqual([]);
		expect(result.lifecycle.surface).toEqual([]);
		expect(
			result.lifecycle.apply.map((s) => `${s.namespace}:${s.slug}`).sort(),
		).toEqual(['prd:answered-prd', 'slice:answered-slice']);
	});
});

describe('the in-place + mirror-side lifecycle enumerations AGREE (ONE shared unit)', () => {
	it('mirror-side scanMirrorPool().lifecycle equals in-place gatherLifecycleInPlace on the SAME state', async () => {
		const gates = {triage: true, surface: true};

		// MIRROR side (bare ref).
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', WORK);
		const mirror = await scanMirrorPool({
			mirrorPath,
			config: mergeConfig({autoBuild: true, autoSlice: true}),
			lifecycleGates: gates,
			env: gitEnv(),
		});

		// IN-PLACE side: lay the SAME logical work/ tree into a plain checkout dir.
		const checkout = join(scratch.root, 'in-place');
		for (const [folder, files] of Object.entries(WORK)) {
			const dir = join(checkout, 'work', folder);
			mkdirSync(dir, {recursive: true});
			for (const [file, content] of Object.entries(
				files as Record<string, string>,
			)) {
				writeFileSync(join(dir, file), content);
			}
		}
		const inPlace = gatherLifecycleInPlace({repoPath: checkout, gates});

		// AGREEMENT: same slugs + namespaces in each sub-pool (repoPath differs by
		// substrate, so compare the namespace:slug projection).
		const proj = (items: {namespace: string; slug: string}[]): string[] =>
			items.map((s) => `${s.namespace}:${s.slug}`).sort();
		expect(proj(mirror.lifecycle.triage)).toEqual(proj(inPlace.triage));
		expect(proj(mirror.lifecycle.surface)).toEqual(proj(inPlace.surface));
		expect(proj(mirror.lifecycle.apply)).toEqual(proj(inPlace.apply));
	});

	it('feeds selectPrioritised identically for the FOUR-pool order (loop shape)', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {
				'build-me.md': slice({slug: 'build-me'}),
				'answered-slice.md': slice({
					slug: 'answered-slice',
					needsAnswers: 'true',
				}),
				'blocked-slice.md': slice({
					slug: 'blocked-slice',
					needsAnswers: 'true',
				}),
			},
			observations: {'triage-me.md': obs({slug: 'triage-me'})},
			questions: {
				'slice-answered-slice.md': sidecar('slice:answered-slice', true),
			},
		});
		const pool = await scanMirrorPool({
			mirrorPath,
			config: mergeConfig({autoBuild: true, autoSlice: true}),
			lifecycleGates: {triage: true, surface: true},
			env: gitEnv(),
		});

		const selected = selectPrioritised({
			report: pool.report,
			caps: {
				maxParallel: Number.MAX_SAFE_INTEGER,
				perRepoMax: Number.MAX_SAFE_INTEGER,
			},
			prds: pool.prds,
			lifecycle: pool.lifecycle,
		});
		expect(selected.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'slice:build-me', // buildable
			'slice:answered-slice', // lifecycle apply
			'slice:blocked-slice', // lifecycle surface
			'observation:triage-me', // lifecycle triage
		]);
	});
});
