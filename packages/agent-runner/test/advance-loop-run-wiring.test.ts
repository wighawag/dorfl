import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {runLoop, type RunTick} from '../src/run.js';
import {advanceRunTick} from '../src/advance-loop-driver.js';
import type {AdvanceTickRunner} from '../src/advance-drivers.js';
import type {AdvanceResult} from '../src/advance.js';
import {mergeConfig} from '../src/config.js';
import {fetchMirrorMain} from '../src/repo-mirror.js';
import {git} from '../src/git.js';
import {
	makeScratch,
	registerMirrorWithWork,
	mirrorSrc,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `advance-drivers-and-gates` — the LOOP DRIVER WIRED INTO `run` (PRD
 * `advance-loop`, US #7/22/31). This is the INTEGRATION proof the requeue asked
 * for: the loop driver ({@link advanceRunTick}) is driven by the REAL `run` loop
 * machinery ({@link runLoop}) through the deliberate {@link RunTick} swap seam
 * (`run.ts` writes `runLoop` against `RunTick` precisely so the advance-loop PRD
 * can swap the tick WITHOUT re-architecting the loop). It proves:
 *
 *   - `run` ACTUALLY drives the advance tick over the mirror-side eligible pool
 *     (the wiring is live, not dead code — the gap Gate-2 flagged);
 *   - the loop DRAINS the eligible pool MONOTONICALLY as items advance (US #31);
 *   - the loop IDLES / is STABLE at rest when every item is a pending no-op (US
 *     #31 calm-at-rest — no thrash across iterations).
 *
 * The per-ITEM advance tick runner is STUBBED (the unit suite `advance.test.ts`
 * pins the real classify→lock→execute pipeline); here we drive the SEAM + the
 * loop + the real mirror-side pool scan, asserting the aggregate convergence.
 */

let scratch: Scratch;
let ws: string;

beforeEach(() => {
	scratch = makeScratch('agent-runner-advance-run-wiring-');
	ws = join(scratch.root, '.agent-runner');
});

afterEach(() => {
	scratch.cleanup();
});

function task(slug: string): string {
	return `---\nslug: ${slug}\n---\n\nbody`;
}

const config = () =>
	mergeConfig({
		autoBuild: true,
		autoTask: true,
		maxParallel: 4,
		perRepoMax: 4,
	});

/** The per-item advance context the build/task rungs would orchestrate `do` with. */
const context = {cwd: '/tmp/advance-run-wiring-cwd-placeholder'};

/** A stub per-item tick runner: every item ADVANCES (exit 0). */
const advanceAll: AdvanceTickRunner = async (options) =>
	({
		exitCode: 0,
		outcome: 'advanced',
		message: `advanced ${options.arg}`,
	}) satisfies AdvanceResult;

/** A stub per-item tick runner: every item is a NO-OP (a pending sidecar idling). */
const noopAll: AdvanceTickRunner = async (options) =>
	({
		exitCode: 0,
		outcome: 'no-op',
		message: `no-op ${options.arg}`,
	}) satisfies AdvanceResult;

/** Remove a backlog task from the mirror SOURCE's `main`, then sync the bare mirror. */
function drainTaskFromMirror(
	name: string,
	mirrorPath: string,
	file: string,
): void {
	const src = mirrorSrc(ws, name);
	const env = gitEnv();
	git(['rm', '-q', join('work', 'tasks', 'todo', file)], src, {env});
	git(['commit', '-q', '-m', `drain ${file}`], src, {env});
	// Sync the bare mirror's local `main` to the source (the advance scan reads the
	// mirror's COMMITTED `main`, not the source).
	fetchMirrorMain(mirrorPath, env);
}

describe('run --advance: the loop driver wired into runLoop via the RunTick seam', () => {
	it('advanceRunTick conforms to RunTick (the swap seam type)', () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'a.md': task('a')},
		});
		const tick: RunTick = advanceRunTick({
			mirrorPath,
			config: config(),
			context,
			run: advanceAll,
			env: gitEnv(),
		});
		expect(typeof tick).toBe('function');
	});

	it('runLoop DRIVES the advance tick over the mirror pool — every eligible item advances', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'a.md': task('a'), 'b.md': task('b'), 'c.md': task('c')},
		});
		const summary = await runLoop({
			config: config(),
			tick: advanceRunTick({
				mirrorPath,
				config: config(),
				context,
				run: advanceAll,
				env: gitEnv(),
			}),
			maxIterations: 1,
			sleep: async () => {},
		});
		expect(summary.iterations).toBe(1);
		// All three eligible tasks advanced this tick (claimed-done in run terms).
		expect(summary.claimedAndDone).toBe(3);
		expect(summary.failed).toBe(0);
		expect(summary.ticks[0].items.map((i) => i.slug).sort()).toEqual([
			'a',
			'b',
			'c',
		]);
	});

	it('IDLES / is STABLE at rest: an all-no-op pool advances NOTHING over many ticks (no thrash)', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'a.md': task('a'), 'b.md': task('b'), 'c.md': task('c')},
		});
		const summary = await runLoop({
			config: config(),
			tick: advanceRunTick({
				mirrorPath,
				config: config(),
				context,
				run: noopAll,
				env: gitEnv(),
			}),
			maxIterations: 5,
			sleep: async () => {},
		});
		expect(summary.iterations).toBe(5);
		// Every tick is calm-at-rest: NOTHING advanced, the same pool idles (mapped
		// to `skipped`, never `failed`) — the loop does not thrash a pending pool.
		expect(summary.claimedAndDone).toBe(0);
		expect(summary.failed).toBe(0);
		expect(summary.skipped).toBe(3 * 5);
		for (const tick of summary.ticks) {
			expect(tick.claimedAndDone).toBe(0);
			expect(tick.items).toHaveLength(3);
		}
	});

	it('DRAINS MONOTONICALLY: the eligible pool shrinks each tick as items resolve', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'a.md': task('a'), 'b.md': task('b'), 'c.md': task('c')},
		});
		// A stub that ADVANCES each item AND drains it from the mirror — the same
		// shape a real done-move has: an advanced item leaves the eligible pool, so
		// the NEXT scan sees a strictly smaller pool.
		let drained = 0;
		const advanceAndDrain: AdvanceTickRunner = async (options) => {
			drainTaskFromMirror('repo', mirrorPath, `${options.arg}.md`);
			drained++;
			return {
				exitCode: 0,
				outcome: 'advanced',
				message: `advanced+drained ${options.arg}`,
			} satisfies AdvanceResult;
		};

		const poolSizes: number[] = [];
		const summary = await runLoop({
			config: mergeConfig({
				autoBuild: true,
				autoTask: true,
				// ONE item per tick so the pool shrinks observably, tick by tick.
				maxParallel: 1,
				perRepoMax: 1,
			}),
			tick: advanceRunTick({
				mirrorPath,
				config: config(),
				context,
				run: advanceAndDrain,
				env: gitEnv(),
			}),
			// Loop until the pool is empty (more than enough iterations).
			maxIterations: 10,
			sleep: async () => {},
			onTick: (result) => poolSizes.push(result.items.length),
		});

		// MONOTONIC shrink: each tick's pool is no larger than the previous, and the
		// loop reaches a stable EMPTY pool (calm at rest) once everything drained.
		for (let i = 1; i < poolSizes.length; i++) {
			expect(poolSizes[i]).toBeLessThanOrEqual(poolSizes[i - 1]);
		}
		expect(poolSizes[0]).toBe(3);
		expect(poolSizes.at(-1)).toBe(0);
		expect(drained).toBe(3);
		// Every item that ran advanced; the empty-pool ticks add nothing.
		expect(summary.claimedAndDone).toBe(3);
		expect(summary.failed).toBe(0);
	});

	it('a FAILED tick maps to needsAttention (the run loop counts it), the batch survives', async () => {
		const {mirrorPath} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'good.md': task('good'), 'boom.md': task('boom')},
		});
		const oneBoom: AdvanceTickRunner = async (options) => {
			if (options.arg === 'boom') {
				return {
					exitCode: 1,
					outcome: 'usage-error',
					message: 'kaboom',
				} satisfies AdvanceResult;
			}
			return {
				exitCode: 0,
				outcome: 'advanced',
				message: 'ok',
			} satisfies AdvanceResult;
		};
		const summary = await runLoop({
			config: config(),
			tick: advanceRunTick({
				mirrorPath,
				config: config(),
				context,
				run: oneBoom,
				env: gitEnv(),
			}),
			maxIterations: 1,
			sleep: async () => {},
		});
		expect(summary.claimedAndDone).toBe(1); // good
		expect(summary.needsAttention).toBe(1); // boom
		expect(summary.failed).toBe(1);
	});
});
