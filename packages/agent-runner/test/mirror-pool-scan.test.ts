import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {scanMirrorPool} from '../src/mirror-pool-scan.js';
import {scanRepoPaths} from '../src/scan.js';
import {sliceablePrds, selectPrioritised} from '../src/select-priority.js';
import {mergeConfig} from '../src/config.js';
import {
	makeScratch,
	registerMirrorWithWork,
	gitEnv,
	fixtureFolderRel,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `mirror-pool-scan` — the MIRROR-SIDE eligible-pool scan: the isolated
 * counterpart to `do-autopick`'s in-place pool scan. It enumerates eligible
 * SLICES + sliceable PRDs from a BARE hub mirror's `main` (NOT a working
 * checkout), using the SAME eligibility (`scan`/`eligibility`) + slicing
 * predicates (`sliceablePrds`/`slicing-eligibility`) as the in-place scan.
 *
 * House `--bare`-mirror style: seed a bare hub mirror (via `registerMirrorWithWork`)
 * whose committed `main` carries a mix of eligible/blocked/needsAnswers/humanOnly
 * slices + sliceable/non-sliceable PRDs, then assert the scan returns exactly the
 * eligible set — and is PARITY-equal to the in-place `scanRepoPaths` + `sliceablePrds`
 * on the SAME logical `work/` state.
 */

let scratch: Scratch;
let ws: string;

beforeEach(() => {
	scratch = makeScratch('agent-runner-mirror-pool-scan-');
	ws = join(scratch.root, '.agent-runner');
});

afterEach(() => {
	scratch.cleanup();
});

/** A minimal slice markdown body with the given frontmatter fields. */
function slice(frontmatter: Record<string, string>): string {
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push('---', '', 'body');
	return lines.join('\n');
}

/** A minimal PRD markdown body with the given frontmatter fields. */
function prd(frontmatter: Record<string, string>): string {
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push('---', '', '# PRD');
	return lines.join('\n');
}

describe('scanMirrorPool — enumerates eligible slices + sliceable PRDs from a BARE mirror main', () => {
	it('returns exactly the eligible slices + sliceable PRDs from a mixed mirror', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {
				// eligible
				'ready.md': slice({slug: 'ready'}),
				// gated out
				'human.md': slice({slug: 'human', humanOnly: 'true'}),
				'asks.md': slice({slug: 'asks', needsAnswers: 'true'}),
				// blocked (dep not done)
				'blocked.md': slice({slug: 'blocked', blockedBy: '[missing]'}),
				// blocked-but-satisfied (dep IS done)
				'unblocked.md': slice({slug: 'unblocked', blockedBy: '[dep]'}),
			},
			done: {'dep.md': slice({slug: 'dep'})},
			prd: {
				// sliceable
				'sliceme.md': prd({slug: 'sliceme'}),
				// gated out
				'prd-human.md': prd({slug: 'prd-human', humanOnly: 'true'}),
				'prd-asks.md': prd({slug: 'prd-asks', needsAnswers: 'true'}),
				// sliceAfter not satisfied (unsliced-dep is NOT in prd-sliced/)
				'after.md': prd({slug: 'after', sliceAfter: '[unsliced-dep]'}),
			},
		});

		const result = await scanMirrorPool({
			mirrorPath,
			config: mergeConfig({autoBuild: true, autoSlice: true}),
			env: gitEnv(),
		});

		// Exactly the eligible slices.
		expect(result.eligibleSlices.map((s) => s.slug).sort()).toEqual([
			'ready',
			'unblocked',
		]);
		// Exactly the sliceable PRDs.
		expect(result.prds.map((p) => p.slug).sort()).toEqual(['sliceme']);
	});

	it('honours the GATES: autoBuild off ⇒ no eligible slice; autoSlice off ⇒ no sliceable PRD', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'ready.md': slice({slug: 'ready'})},
			prd: {'sliceme.md': prd({slug: 'sliceme'})},
		});

		const strict = await scanMirrorPool({
			mirrorPath,
			config: mergeConfig({autoBuild: false, autoSlice: false}),
			env: gitEnv(),
		});
		expect(strict.eligibleSlices).toEqual([]);
		expect(strict.prds).toEqual([]);

		const permissive = await scanMirrorPool({
			mirrorPath,
			config: mergeConfig({autoBuild: true, autoSlice: true}),
			env: gitEnv(),
		});
		expect(permissive.eligibleSlices.map((s) => s.slug)).toEqual(['ready']);
		expect(permissive.prds.map((p) => p.slug)).toEqual(['sliceme']);
	});

	it('layers the COMMITTED per-repo .agent-runner.json from the mirror main (parity with the working checkout that reads it)', async () => {
		// Global is strict; the committed per-repo file opts in — the mirror scan reads
		// it from `main:.agent-runner.json` (the `do --remote` per-repo seam), so the
		// slice/PRD become eligible exactly as an in-place checkout would resolve them.
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'ready.md': slice({slug: 'ready'})},
			prd: {'sliceme.md': prd({slug: 'sliceme'})},
			repoConfig: {autoBuild: true, autoSlice: true},
		});

		const result = await scanMirrorPool({
			mirrorPath,
			config: mergeConfig({autoBuild: false, autoSlice: false}),
			env: gitEnv(),
		});
		expect(result.eligibleSlices.map((s) => s.slug)).toEqual(['ready']);
		expect(result.prds.map((p) => p.slug)).toEqual(['sliceme']);
	});

	it('resolves blockedBy / sliceAfter against the mirror own folders (per-repo, like in-place)', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'b.md': slice({slug: 'b', blockedBy: '[a]'})},
			prd: {'after.md': prd({slug: 'after', sliceAfter: '[alpha]'})},
		});
		const cfg = mergeConfig({autoBuild: true, autoSlice: true});

		// a not done, alpha not sliced ⇒ neither eligible.
		const before = await scanMirrorPool({
			mirrorPath,
			config: cfg,
			env: gitEnv(),
		});
		expect(before.eligibleSlices).toEqual([]);
		expect(before.prds).toEqual([]);

		// Re-seed with the deps satisfied (fresh mirror).
		scratch.cleanup();
		scratch = makeScratch('agent-runner-mirror-pool-scan-');
		ws = join(scratch.root, '.agent-runner');
		const second = registerMirrorWithWork(ws, 'repo', {
			backlog: {'b.md': slice({slug: 'b', blockedBy: '[a]'})},
			done: {'a.md': slice({slug: 'a'})},
			prd: {
				'after.md': prd({slug: 'after', sliceAfter: '[alpha]'}),
			},
			prdSliced: {'alpha.md': prd({slug: 'alpha'})},
		});
		const after = await scanMirrorPool({
			mirrorPath: second.mirrorPath,
			config: cfg,
			env: gitEnv(),
		});
		expect(after.eligibleSlices.map((s) => s.slug)).toEqual(['b']);
		expect(after.prds.map((p) => p.slug)).toEqual(['after']);
	});
});

describe('PARITY with the in-place do-autopick pool scan on the SAME logical state', () => {
	it('mirror-side scan returns the same eligible slices + sliceable PRDs as scanRepoPaths + sliceablePrds in-place', async () => {
		const mixed = {
			backlog: {
				'ready.md': slice({slug: 'ready'}),
				'human.md': slice({slug: 'human', humanOnly: 'true'}),
				'unblocked.md': slice({slug: 'unblocked', blockedBy: '[dep]'}),
			},
			done: {'dep.md': slice({slug: 'dep'})},
			prd: {
				'sliceme.md': prd({slug: 'sliceme'}),
				'after.md': prd({slug: 'after', sliceAfter: '[alpha]'}),
			},
			prdSliced: {'alpha.md': prd({slug: 'alpha'})},
		};
		const cfg = mergeConfig({autoBuild: true, autoSlice: true});

		// MIRROR side (bare ref).
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', mixed);
		const mirror = await scanMirrorPool({
			mirrorPath,
			config: cfg,
			env: gitEnv(),
		});

		// IN-PLACE side: lay the SAME logical work/ tree into a plain checkout dir and
		// run the in-place pool scan the way `do-autopick` does.
		const checkout = join(scratch.root, 'in-place');
		for (const [folder, files] of Object.entries(mixed)) {
			// Normalise the camelCase fixture key to its work-layout folder KEY, then
			// resolve to the CURRENT on-disk path so the in-place tree mirrors what the
			// production scan (and the bare-mirror side) now read after the
			// notes-regroup + task-board-rename flip (`backlog`->`tasks/todo`, etc.).
			const dir = join(
				checkout,
				'work',
				fixtureFolderRel(folder === 'prdSliced' ? 'prd-sliced' : folder),
			);
			mkdirSync(dir, {recursive: true});
			for (const [file, content] of Object.entries(
				files as Record<string, string>,
			)) {
				writeFileSync(join(dir, file), content);
			}
		}
		const inPlaceReport = scanRepoPaths([checkout], cfg);
		const inPlacePrds = sliceablePrds({
			candidates: (await import('../src/ledger-read.js')).ledgerRead
				.resolvePrdPool({repoPath: checkout})
				.prds.map((p) => ({
					repoPath: checkout,
					slug: p.slug,
					humanOnly: p.humanOnly,
					needsAnswers: p.needsAnswers,
					sliceAfter: p.sliceAfter,
				})),
			slicedSlugs: (
				await import('../src/ledger-read.js')
			).ledgerRead.resolvePrdPool({repoPath: checkout}).slicedSlugs,
			autoSlice: cfg.autoSlice,
		});

		// PARITY: the eligible slice slugs + sliceable PRD slugs match exactly.
		expect(mirror.eligibleSlices.map((s) => s.slug).sort()).toEqual(
			inPlaceReport.repos[0].items
				.filter((i) => i.eligibility.eligible)
				.map((i) => i.slug)
				.sort(),
		);
		expect(mirror.prds.map((p) => p.slug).sort()).toEqual(
			inPlacePrds.map((p) => p.slug).sort(),
		);
	});
});

describe('ONE reusable unit: both the run loop driver and the one-shot/CI advance driver consume the SAME scan', () => {
	it('feeds selectPrioritised identically for a LOOP shape (take all) and a ONE-SHOT shape (sequential count)', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {
				'alpha.md': slice({slug: 'alpha'}),
				'beta.md': slice({slug: 'beta'}),
			},
			prd: {'gamma.md': prd({slug: 'gamma'})},
		});
		const cfg = mergeConfig({autoBuild: true, autoSlice: true});
		const pool = await scanMirrorPool({mirrorPath, config: cfg, env: gitEnv()});

		// Build the PRD candidate list the SAME way do-autopick does, from the pool the
		// mirror scan returns (no duplicated enumeration).
		const prdCandidates = pool.prds;

		// LOOP driver shape (`run`): take ALL eligible, parallelism is the loop's job.
		const loopSelection = selectPrioritised({
			report: pool.report,
			caps: {
				maxParallel: Number.MAX_SAFE_INTEGER,
				perRepoMax: Number.MAX_SAFE_INTEGER,
			},
			prds: prdCandidates,
		});
		expect(loopSelection.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'slice:alpha',
			'slice:beta',
			'prd:gamma',
		]);

		// ONE-SHOT driver shape (`advance --remote -n 2`): ALWAYS SEQUENTIAL, bound by
		// count — the scan ONLY enumerates; -n never adds parallelism.
		const oneShotSelection = selectPrioritised({
			report: pool.report,
			caps: {
				maxParallel: Number.MAX_SAFE_INTEGER,
				perRepoMax: Number.MAX_SAFE_INTEGER,
			},
			prds: prdCandidates,
			count: 2,
		});
		expect(oneShotSelection.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'slice:alpha',
			'slice:beta',
		]);
	});
});
