import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {scanMirrorPool} from '../src/mirror-pool-scan.js';
import {scanRepoPaths} from '../src/scan.js';
import {taskableBriefs, selectPrioritised} from '../src/select-priority.js';
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
 * TASKS + taskable PRDs from a BARE hub mirror's `main` (NOT a working
 * checkout), using the SAME eligibility (`scan`/`eligibility`) + tasking
 * predicates (`taskablePrds`/`tasking-eligibility`) as the in-place scan.
 *
 * House `--bare`-mirror style: seed a bare hub mirror (via `registerMirrorWithWork`)
 * whose committed `main` carries a mix of eligible/blocked/needsAnswers/humanOnly
 * tasks + taskable/non-taskable PRDs, then assert the scan returns exactly the
 * eligible set — and is PARITY-equal to the in-place `scanRepoPaths` + `taskablePrds`
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

/** A minimal task markdown body with the given frontmatter fields. */
function task(frontmatter: Record<string, string>): string {
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push('---', '', 'body');
	return lines.join('\n');
}

/** A minimal PRD markdown body with the given frontmatter fields. */
function brief(frontmatter: Record<string, string>): string {
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push('---', '', '# PRD');
	return lines.join('\n');
}

describe('scanMirrorPool — enumerates eligible tasks + taskable PRDs from a BARE mirror main', () => {
	it('returns exactly the eligible tasks + taskable PRDs from a mixed mirror', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {
				// eligible
				'ready.md': task({slug: 'ready'}),
				// gated out
				'human.md': task({slug: 'human', humanOnly: 'true'}),
				'asks.md': task({slug: 'asks', needsAnswers: 'true'}),
				// blocked (dep not done)
				'blocked.md': task({slug: 'blocked', blockedBy: '[missing]'}),
				// blocked-but-satisfied (dep IS done)
				'unblocked.md': task({slug: 'unblocked', blockedBy: '[dep]'}),
			},
			done: {'dep.md': task({slug: 'dep'})},
			brief: {
				// taskable
				'taskme.md': brief({slug: 'taskme'}),
				// gated out
				'brief-human.md': brief({slug: 'brief-human', humanOnly: 'true'}),
				'brief-asks.md': brief({slug: 'brief-asks', needsAnswers: 'true'}),
				// briefAfter not satisfied (untasked-dep is NOT in prd-tasked/)
				'after.md': brief({slug: 'after', briefAfter: '[untasked-dep]'}),
			},
		});

		const result = await scanMirrorPool({
			mirrorPath,
			config: mergeConfig({autoBuild: true, autoTask: true}),
			env: gitEnv(),
		});

		// Exactly the eligible tasks.
		expect(result.eligibleTasks.map((s) => s.slug).sort()).toEqual([
			'ready',
			'unblocked',
		]);
		// Exactly the taskable PRDs.
		expect(result.briefs.map((p) => p.slug).sort()).toEqual(['taskme']);
	});

	it('honours the GATES: autoBuild off ⇒ no eligible task; autoTask off ⇒ no taskable PRD', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'ready.md': task({slug: 'ready'})},
			brief: {'taskme.md': brief({slug: 'taskme'})},
		});

		const strict = await scanMirrorPool({
			mirrorPath,
			config: mergeConfig({autoBuild: false, autoTask: false}),
			env: gitEnv(),
		});
		expect(strict.eligibleTasks).toEqual([]);
		expect(strict.briefs).toEqual([]);

		const permissive = await scanMirrorPool({
			mirrorPath,
			config: mergeConfig({autoBuild: true, autoTask: true}),
			env: gitEnv(),
		});
		expect(permissive.eligibleTasks.map((s) => s.slug)).toEqual(['ready']);
		expect(permissive.briefs.map((p) => p.slug)).toEqual(['taskme']);
	});

	it('layers the COMMITTED per-repo .agent-runner.json from the mirror main (parity with the working checkout that reads it)', async () => {
		// Global is strict; the committed per-repo file opts in — the mirror scan reads
		// it from `main:.agent-runner.json` (the `do --remote` per-repo seam), so the
		// task/PRD become eligible exactly as an in-place checkout would resolve them.
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'ready.md': task({slug: 'ready'})},
			brief: {'taskme.md': brief({slug: 'taskme'})},
			repoConfig: {autoBuild: true, autoTask: true},
		});

		const result = await scanMirrorPool({
			mirrorPath,
			config: mergeConfig({autoBuild: false, autoTask: false}),
			env: gitEnv(),
		});
		expect(result.eligibleTasks.map((s) => s.slug)).toEqual(['ready']);
		expect(result.briefs.map((p) => p.slug)).toEqual(['taskme']);
	});

	it('resolves blockedBy / briefAfter against the mirror own folders (per-repo, like in-place)', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'b.md': task({slug: 'b', blockedBy: '[a]'})},
			brief: {'after.md': brief({slug: 'after', briefAfter: '[alpha]'})},
		});
		const cfg = mergeConfig({autoBuild: true, autoTask: true});

		// a not done, alpha not tasked ⇒ neither eligible.
		const before = await scanMirrorPool({
			mirrorPath,
			config: cfg,
			env: gitEnv(),
		});
		expect(before.eligibleTasks).toEqual([]);
		expect(before.briefs).toEqual([]);

		// Re-seed with the deps satisfied (fresh mirror).
		scratch.cleanup();
		scratch = makeScratch('agent-runner-mirror-pool-scan-');
		ws = join(scratch.root, '.agent-runner');
		const second = registerMirrorWithWork(ws, 'repo', {
			backlog: {'b.md': task({slug: 'b', blockedBy: '[a]'})},
			done: {'a.md': task({slug: 'a'})},
			brief: {
				'after.md': brief({slug: 'after', briefAfter: '[alpha]'}),
			},
			briefTasked: {'alpha.md': brief({slug: 'alpha'})},
		});
		const after = await scanMirrorPool({
			mirrorPath: second.mirrorPath,
			config: cfg,
			env: gitEnv(),
		});
		expect(after.eligibleTasks.map((s) => s.slug)).toEqual(['b']);
		expect(after.briefs.map((p) => p.slug)).toEqual(['after']);
	});
});

describe('PARITY with the in-place do-autopick pool scan on the SAME logical state', () => {
	it('mirror-side scan returns the same eligible tasks + taskable PRDs as scanRepoPaths + taskablePrds in-place', async () => {
		const mixed = {
			backlog: {
				'ready.md': task({slug: 'ready'}),
				'human.md': task({slug: 'human', humanOnly: 'true'}),
				'unblocked.md': task({slug: 'unblocked', blockedBy: '[dep]'}),
			},
			done: {'dep.md': task({slug: 'dep'})},
			brief: {
				'taskme.md': brief({slug: 'taskme'}),
				'after.md': brief({slug: 'after', briefAfter: '[alpha]'}),
			},
			briefTasked: {'alpha.md': brief({slug: 'alpha'})},
		};
		const cfg = mergeConfig({autoBuild: true, autoTask: true});

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
				fixtureFolderRel(folder === 'briefTasked' ? 'briefTasked' : folder),
			);
			mkdirSync(dir, {recursive: true});
			for (const [file, content] of Object.entries(
				files as Record<string, string>,
			)) {
				writeFileSync(join(dir, file), content);
			}
		}
		const inPlaceReport = scanRepoPaths([checkout], cfg);
		const inPlaceBriefs = taskableBriefs({
			candidates: (await import('../src/ledger-read.js')).ledgerRead
				.resolveBriefPool({repoPath: checkout})
				.briefs.map((p) => ({
					repoPath: checkout,
					slug: p.slug,
					humanOnly: p.humanOnly,
					needsAnswers: p.needsAnswers,
					briefAfter: p.briefAfter,
				})),
			taskedSlugs: (
				await import('../src/ledger-read.js')
			).ledgerRead.resolveBriefPool({repoPath: checkout}).taskedSlugs,
			autoTask: cfg.autoTask,
		});

		// PARITY: the eligible task slugs + taskable PRD slugs match exactly.
		expect(mirror.eligibleTasks.map((s) => s.slug).sort()).toEqual(
			inPlaceReport.repos[0].items
				.filter((i) => i.eligibility.eligible)
				.map((i) => i.slug)
				.sort(),
		);
		expect(mirror.briefs.map((p) => p.slug).sort()).toEqual(
			inPlaceBriefs.map((p) => p.slug).sort(),
		);
	});
});

describe('ONE reusable unit: both the run loop driver and the one-shot/CI advance driver consume the SAME scan', () => {
	it('feeds selectPrioritised identically for a LOOP shape (take all) and a ONE-SHOT shape (sequential count)', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {
				'alpha.md': task({slug: 'alpha'}),
				'beta.md': task({slug: 'beta'}),
			},
			brief: {'gamma.md': brief({slug: 'gamma'})},
		});
		const cfg = mergeConfig({autoBuild: true, autoTask: true});
		const pool = await scanMirrorPool({mirrorPath, config: cfg, env: gitEnv()});

		// Build the PRD candidate list the SAME way do-autopick does, from the pool the
		// mirror scan returns (no duplicated enumeration).
		const briefCandidates = pool.briefs;

		// LOOP driver shape (`run`): take ALL eligible, parallelism is the loop's job.
		const loopSelection = selectPrioritised({
			report: pool.report,
			caps: {
				maxParallel: Number.MAX_SAFE_INTEGER,
				perRepoMax: Number.MAX_SAFE_INTEGER,
			},
			briefs: briefCandidates,
		});
		expect(loopSelection.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'task:alpha',
			'task:beta',
			'brief:gamma',
		]);

		// ONE-SHOT driver shape (`advance --remote -n 2`): ALWAYS SEQUENTIAL, bound by
		// count — the scan ONLY enumerates; -n never adds parallelism.
		const oneShotSelection = selectPrioritised({
			report: pool.report,
			caps: {
				maxParallel: Number.MAX_SAFE_INTEGER,
				perRepoMax: Number.MAX_SAFE_INTEGER,
			},
			briefs: briefCandidates,
			count: 2,
		});
		expect(oneShotSelection.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'task:alpha',
			'task:beta',
		]);
	});
});
