import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {
	runLoop,
	runOnce,
	type AgentRunner,
	type RunOnceResult,
	type RunOnceOptions,
} from '../src/run.js';
import {mergeConfig} from '../src/config.js';
import {scan} from '../src/scan.js';
import {remoteAdd} from '../src/registry.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-run-loop-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

const PASS = 'exit 0';
const FAIL = 'exit 1';

/**
 * An agent that edits a file (non-empty commit) and succeeds. The content is
 * SLUG-SPECIFIC so two concurrently-claimed items never write byte-identical
 * content to the SAME path (which, after the first merges, would make the
 * second's diff vs the advanced main empty and trip the `agent-stop-signal`
 * empty-diff backstop).
 */
const editingAgent: AgentRunner = ({cwd, slug}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), `work done for ${slug}\n`);
	return {ok: true};
};

// A NON-conflicting editing agent: each slug writes its OWN disjoint file. Two
// same-repo jobs then touch DIFFERENT paths, so the both-land contract is
// DETERMINISTIC (no add/add conflict on a SHARED `agent-output.txt` when two
// worktrees are cut from the same base concurrently — which the fresh rebased-tip
// gate's added latency makes reachable; with the shared file that is a GENUINE
// code conflict that correctly routes ONE job to needs-attention, masking the
// both-land assertion). Mirrors `run.test.ts`'s `disjointEditingAgent`.
const disjointEditingAgent: AgentRunner = ({cwd, slug}) => {
	writeFileSync(join(cwd, `${slug}.txt`), `work done for ${slug}\n`);
	return {ok: true};
};

/** A do-nothing tick result (the loop's stop logic is independent of tick work). */
const emptyResult = (): RunOnceResult => ({
	claimedAndDone: 0,
	skipped: 0,
	failed: 0,
	needsAttention: 0,
	items: [],
});

const baseOptions = (): RunOnceOptions => ({
	config: mergeConfig({agentCmd: 'true'}),
});

describe('runLoop — stop conditions (injected fake tick, no real work)', () => {
	it('honours maxIterations: runs exactly N ticks then stops', async () => {
		let calls = 0;
		const result = await runLoop({
			...baseOptions(),
			maxIterations: 3,
			tick: async () => {
				calls++;
				return emptyResult();
			},
		});
		expect(calls).toBe(3);
		expect(result.iterations).toBe(3);
		expect(result.stoppedBy).toBe('max-iterations');
	});

	it('honours maxDurationMs: stops once the (injected) clock passes the deadline', async () => {
		let t = 1000;
		let calls = 0;
		const result = await runLoop({
			...baseOptions(),
			maxDurationMs: 50,
			// Each tick advances the fake clock by 20ms; the 3rd check (t=1060) is past
			// start+50=1050, so exactly the ticks at t=1000,1020,1040 run (3 ticks).
			now: () => t,
			tick: async () => {
				calls++;
				t += 20;
				return emptyResult();
			},
		});
		expect(result.stoppedBy).toBe('max-duration');
		expect(calls).toBe(3);
		expect(result.iterations).toBe(3);
	});

	it('stops on a cooperative stop() signal (the SIGINT graceful-shutdown seam)', async () => {
		let calls = 0;
		let stop = false;
		const result = await runLoop({
			...baseOptions(),
			// No iteration/duration bound — this is the FOREVER daemon, ended only by
			// the stop signal (proving the no-bound form terminates on the signal).
			stop: () => stop,
			tick: async () => {
				calls++;
				if (calls === 2) {
					stop = true; // request shutdown after the 2nd tick
				}
				return emptyResult();
			},
		});
		expect(calls).toBe(2);
		expect(result.stoppedBy).toBe('signal');
	});

	it('a pre-set stop() runs ZERO ticks (checked before the first tick)', async () => {
		let calls = 0;
		const result = await runLoop({
			...baseOptions(),
			stop: () => true,
			tick: async () => {
				calls++;
				return emptyResult();
			},
		});
		expect(calls).toBe(0);
		expect(result.iterations).toBe(0);
		expect(result.stoppedBy).toBe('signal');
	});

	it('sleeps between ticks via the injected sleep seam (interval honoured, no real wait)', async () => {
		const sleeps: number[] = [];
		await runLoop({
			...baseOptions(),
			maxIterations: 3,
			intervalMs: 500,
			sleep: async (ms) => {
				sleeps.push(ms);
			},
			tick: async () => emptyResult(),
		});
		// A sleep happens BETWEEN ticks, never after the last (we broke on the bound
		// before sleeping): 3 ticks ⇒ 2 inter-tick sleeps.
		expect(sleeps).toEqual([500, 500]);
	});

	it('aggregates per-tick counts across the session', async () => {
		const results: RunOnceResult[] = [
			{...emptyResult(), claimedAndDone: 1},
			{...emptyResult(), claimedAndDone: 2, needsAttention: 1, failed: 1},
		];
		let i = 0;
		const summary = await runLoop({
			...baseOptions(),
			maxIterations: 2,
			tick: async () => results[i++],
		});
		expect(summary.claimedAndDone).toBe(3);
		expect(summary.needsAttention).toBe(1);
		expect(summary.failed).toBe(1);
		expect(summary.ticks).toHaveLength(2);
	});
});

describe('runLoop — over the real registry (default tick = runOnce, multi-repo)', () => {
	/**
	 * Register a seeded repo's `--bare` arbiter as a hub mirror under the workspace
	 * registry (`remote add <file://arbiter>`), so the registry `scan` finds it.
	 */
	function registerSeeded(arbiter: string, workspacesDir: string): void {
		remoteAdd({
			target: `file://${arbiter}`,
			workspacesDir,
			env: gitEnv(),
		});
	}

	it('a single bounded session drains eligible work across MULTIPLE registered repos', async () => {
		// Two independent repos+arbiters, each registered in the same registry.
		const a = seedRepoWithArbiter(join(scratch.root, 'a'), ['fa']);
		const b = seedRepoWithArbiter(join(scratch.root, 'b'), ['fb']);
		const workspacesDir = join(scratch.root, 'ws');
		registerSeeded(a.arbiter, workspacesDir);
		registerSeeded(b.arbiter, workspacesDir);

		const config = mergeConfig({
			workspacesDir,
			defaultArbiter: 'origin', // inside a mirror's clone the arbiter is `origin`
			maxParallel: 4,
			perRepoMax: 2,
			integration: 'merge',
			agentCmd: 'true',
			verify: PASS,
			autoBuild: true,
		});

		// No injected report ⇒ each tick scans the REGISTRY (the hub-mirror set),
		// proving `run` loops over the registry, not a roots walk. One iteration is
		// enough to span both repos.
		const summary = await runLoop({
			config,
			workspace: workspacesDir,
			maxIterations: 1,
			agentRunner: editingAgent,
			env: gitEnv(),
		});

		expect(summary.iterations).toBe(1);
		expect(summary.claimedAndDone).toBe(2);
		// Both repos' items integrated to their own arbiter main in the one tick.
		expect(existsOnArbiterMain(a.repo, 'done', 'fa')).toBe(true);
		expect(existsOnArbiterMain(b.repo, 'done', 'fb')).toBe(true);
	});

	it('runs TWO same-repo items via the bare mirror CONCURRENTLY (merge) — claim+worktree+integration safe', async () => {
		// The registry path claims in a throwaway clone of the BARE mirror and cuts a
		// distinct job worktree per slug. Two same-repo items under maxParallel 2 +
		// merge integration exercise every concurrency hazard at once (shared-mirror
		// claim race serialised per repo; the Race-1 claim-vs-integrate merge-push
		// re-rebase-and-retry; the Race-2 sibling-ledger reconcile; distinct-slug
		// worktree isolation). Both must reach done with no claim-error. DISJOINT-file
		// agent so the both-land contract is deterministic: with the fresh rebased-tip
		// gate ON (the default, now run at any perRepoMax) two worktrees can be cut from
		// the same base concurrently, and a SHARED file would then be a GENUINE add/add
		// code conflict (correctly routing ONE to needs-attention) — disjoint files keep
		// the assertion about CONCURRENCY safety, not about conflict resolution.
		const seeded = seedRepoWithArbiter(scratch.root, ['a', 'b', 'c']);
		const workspacesDir = join(scratch.root, 'ws');
		registerSeeded(seeded.arbiter, workspacesDir);
		const config = mergeConfig({
			workspacesDir,
			defaultArbiter: 'origin',
			maxParallel: 2,
			perRepoMax: 10,
			integration: 'merge',
			agentCmd: 'true',
			verify: PASS,
			autoBuild: true,
		});
		const result = await runOnce({
			config,
			workspace: workspacesDir,
			agentRunner: disjointEditingAgent,
			env: gitEnv(),
		});
		expect(result.items).toHaveLength(2);
		expect(result.claimedAndDone).toBe(2);
		expect(result.items.every((i) => i.status === 'claimed-done')).toBe(true);
		expect(existsOnArbiterMain(seeded.repo, 'done', 'a')).toBe(true);
		expect(existsOnArbiterMain(seeded.repo, 'done', 'b')).toBe(true);
	});

	it('a failing item is surfaced via the EXISTING needs-attention seam (on main), not infinite-retried', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['feat']);
		const workspacesDir = join(scratch.root, 'ws');
		registerSeeded(seeded.arbiter, workspacesDir);

		const config = mergeConfig({
			workspacesDir,
			defaultArbiter: 'origin',
			maxParallel: 4,
			perRepoMax: 2,
			integration: 'merge',
			agentCmd: 'true',
			verify: FAIL, // red gate → the item routes to needs-attention via the seam
			autoBuild: true,
		});

		let ticksRun = 0;
		const summary = await runLoop({
			config,
			workspace: workspacesDir,
			// A BOUNDED session of 3 ticks — if the loop infinite-retried the stuck
			// item we would see it claimed+failed every tick; instead the seam moves
			// it OUT of backlog (to needs-attention on main) so later ticks find
			// nothing eligible. We assert exactly that.
			maxIterations: 3,
			agentRunner: editingAgent,
			env: gitEnv(),
			onTick: () => {
				ticksRun++;
			},
		});

		expect(ticksRun).toBe(3);
		// The FIRST tick claimed + failed the item, routing it through the seam
		// (surfaced on main as needs-attention, NOT a bespoke reporter).
		expect(summary.ticks[0].failed).toBe(1);
		expect(summary.ticks[0].needsAttention).toBe(1);
		// It is on main as needs-attention (the existing on-main surfacing) and is
		// NOT in backlog/in-progress.
		expect(existsOnArbiterMain(seeded.repo, 'needs-attention', 'feat')).toBe(
			true,
		);
		// NOT infinite-retried: once surfaced (out of backlog), the later ticks find
		// it ineligible — they do NOT re-claim it. So the item is failed AT MOST once.
		const totalFailed = summary.failed;
		expect(totalFailed).toBe(1);
		// Later ticks are no-ops on this item (nothing eligible remains).
		expect(summary.ticks[1].items).toHaveLength(0);
		expect(summary.ticks[2].items).toHaveLength(0);
	});

	it('run --once is exactly one tick (runOnce) and does not throw', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['feat']);
		const workspacesDir = join(scratch.root, 'ws');
		registerSeeded(seeded.arbiter, workspacesDir);
		const config = mergeConfig({
			workspacesDir,
			defaultArbiter: 'origin',
			maxParallel: 4,
			perRepoMax: 2,
			integration: 'merge',
			agentCmd: 'true',
			verify: PASS,
			autoBuild: true,
		});
		// `run --once` calls runOnce directly (the debug/test affordance). Scanning
		// the registry, it claims + integrates the one item in a single tick.
		const result = await runOnce({
			config,
			workspace: workspacesDir,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.claimedAndDone).toBe(1);
		expect(existsOnArbiterMain(seeded.repo, 'done', 'feat')).toBe(true);
	});
});
