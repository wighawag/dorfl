import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {
	advanceOnce,
	advanceBatchSummary,
	isBatchCalmAtRest,
} from '../src/advance-loop-driver.js';
import type {AdvanceTickRunner} from '../src/advance-drivers.js';
import type {AdvanceResult} from '../src/advance.js';
import {mergeConfig} from '../src/config.js';
import {
	makeScratch,
	registerMirrorWithWork,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `advance-drivers-and-gates` — the LOOP DRIVER (`run` ≡ CI) over the advance
 * TICK: loop the tick over the eligible SET (via the SHARED mirror-side pool
 * scan), with genuine PARALLELISM, each item independently `advancing`-lock-
 * guarded inside the tick. House `--bare`-mirror style: a bare hub mirror whose
 * committed `main` carries the eligible pool, a STUBBED tick runner (so we assert
 * WHICH items advanced + the parallelism + the drain, without driving the real
 * lock/agent pipeline — advance.test.ts pins that), and the CONVERGENCE
 * projection (drain monotonically; idle at rest).
 */

let scratch: Scratch;
let ws: string;

beforeEach(() => {
	scratch = makeScratch('dorfl-advance-loop-');
	ws = join(scratch.root, '.dorfl');
});

afterEach(() => {
	scratch.cleanup();
});

function task(frontmatter: Record<string, string>): string {
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) lines.push(`${k}: ${v}`);
	lines.push('---', '', 'body');
	return lines.join('\n');
}

function prd(frontmatter: Record<string, string>): string {
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) lines.push(`${k}: ${v}`);
	lines.push('---', '', '# PRD');
	return lines.join('\n');
}

/** A recording tick runner: captures each `arg`, returns a chosen outcome. */
function recordingRunner(
	outcomeFor: (arg: string) => AdvanceResult['outcome'] = () => 'advanced',
): {run: AdvanceTickRunner; args: string[]} {
	const args: string[] = [];
	const run: AdvanceTickRunner = async (options) => {
		args.push(options.arg);
		const outcome = outcomeFor(options.arg);
		return {
			exitCode: outcome === 'no-op' || outcome === 'advanced' ? 0 : 1,
			outcome,
			message: `${outcome} ${options.arg}`,
		} satisfies AdvanceResult;
	};
	return {run, args};
}

const config = () => mergeConfig({autoBuild: true, autoTask: true});

const context = {cwd: scratchCwd()};
function scratchCwd(): string {
	// The tick's in-place context cwd is irrelevant for the stubbed runner (it
	// records args, never touches disk); a placeholder keeps the type happy.
	return '/tmp/advance-loop-cwd-placeholder';
}

describe('advanceOnce — loops the tick over the eligible SET (mirror pool), gated', () => {
	it('selects the WHOLE eligible pool (tasks-first then PRDs) and advances each', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {
				'alpha.md': task({slug: 'alpha'}),
				'human.md': task({slug: 'human', humanOnly: 'true'}), // gated out
			},
			prd: {'gamma.md': prd({slug: 'gamma'})},
		});
		const {run, args} = recordingRunner();
		const result = await advanceOnce({
			mirrorPath,
			config: config(),
			context,
			run,
			env: gitEnv(),
		});
		// the eligible task + the taskable PRD (not the humanOnly task).
		expect(args.sort()).toEqual(['alpha', 'prd:gamma']);
		expect(result.items).toHaveLength(2);
	});

	it('honours the per-action GATES via the mirror scan (gates off ⇒ empty batch)', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'alpha.md': task({slug: 'alpha'})},
			prd: {'gamma.md': prd({slug: 'gamma'})},
		});
		const {run, args} = recordingRunner();
		const result = await advanceOnce({
			mirrorPath,
			config: mergeConfig({autoBuild: false, autoTask: false}),
			context,
			run,
			env: gitEnv(),
		});
		expect(args).toEqual([]);
		expect(result.items).toEqual([]);
	});
});

describe('advanceOnce — genuine PARALLELISM, each item lock-guarded in the tick', () => {
	it('runs ticks CONCURRENTLY up to maxParallel (overlap observed)', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {
				'a.md': task({slug: 'a'}),
				'b.md': task({slug: 'b'}),
				'c.md': task({slug: 'c'}),
			},
		});
		let inFlight = 0;
		let maxObserved = 0;
		const run: AdvanceTickRunner = async () => {
			inFlight++;
			maxObserved = Math.max(maxObserved, inFlight);
			await new Promise((r) => setTimeout(r, 10));
			inFlight--;
			return {exitCode: 0, outcome: 'advanced', message: ''};
		};
		await advanceOnce({
			mirrorPath,
			config: mergeConfig({
				autoBuild: true,
				autoTask: true,
				maxParallel: 3,
				perRepoMax: 3,
			}),
			context,
			run,
			env: gitEnv(),
		});
		// More than one tick was in flight at once — the loop driver is parallel
		// (unlike the one-shot `-n`, which is always sequential).
		expect(maxObserved).toBeGreaterThan(1);
	});

	it('a thrown tick is CAPTURED (never aborts the batch)', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {
				'good.md': task({slug: 'good'}),
				'boom.md': task({slug: 'boom'}),
			},
		});
		const run: AdvanceTickRunner = async (options) => {
			if (options.arg === 'boom') throw new Error('kaboom');
			return {exitCode: 0, outcome: 'advanced', message: 'ok'};
		};
		const result = await advanceOnce({
			mirrorPath,
			config: config(),
			context,
			run,
			env: gitEnv(),
		});
		expect(result.items).toHaveLength(2);
		const boom = result.items.find((i) => i.arg === 'boom');
		expect(boom?.result.exitCode).toBe(1);
		expect(boom?.result.message).toMatch(/kaboom/);
		// the OTHER item still ran + succeeded.
		const good = result.items.find((i) => i.arg === 'good');
		expect(good?.result.exitCode).toBe(0);
	});
});

describe('advanceOnce — convergence: DRAINS monotonically, IDLES at rest (US #31)', () => {
	it('a pending-sidecar pool is STABLE — every tick a no-op, calm at rest', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {
				'a.md': task({slug: 'a'}),
				'b.md': task({slug: 'b'}),
				'c.md': task({slug: 'c'}),
			},
		});
		const {run} = recordingRunner(() => 'no-op');
		const batch = await advanceOnce({
			mirrorPath,
			config: config(),
			context,
			run,
			env: gitEnv(),
		});
		const summary = advanceBatchSummary(batch);
		expect(summary).toEqual({advanced: 0, idle: 3, stuck: 0, total: 3});
		expect(isBatchCalmAtRest(batch)).toBe(true);
	});

	it('the pool DRAINS MONOTONICALLY as answers arrive (idle count strictly shrinks)', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {
				'a.md': task({slug: 'a'}),
				'b.md': task({slug: 'b'}),
				'c.md': task({slug: 'c'}),
			},
		});

		// Batch 1: all pending ⇒ all idle (calm at rest).
		const b1 = await advanceOnce({
			mirrorPath,
			config: config(),
			context,
			run: recordingRunner(() => 'no-op').run,
			env: gitEnv(),
		});
		expect(isBatchCalmAtRest(b1)).toBe(true);
		const s1 = advanceBatchSummary(b1);

		// Batch 2: the human answered `a` ⇒ its tick ADVANCES; the rest idle.
		const b2 = await advanceOnce({
			mirrorPath,
			config: config(),
			context,
			run: recordingRunner((arg) => (arg === 'a' ? 'advanced' : 'no-op')).run,
			env: gitEnv(),
		});
		const s2 = advanceBatchSummary(b2);
		expect(s2.advanced).toBe(1);
		expect(isBatchCalmAtRest(b2)).toBe(false); // progress, not at rest
		// MONOTONIC drain: the idle (candidate-pool) count strictly shrank.
		expect(s2.idle).toBeLessThan(s1.idle);
	});
});
