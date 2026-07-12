/**
 * Worker for the cross-job concurrent-land test (Story 13's CROSS-PROCESS half
 * of `land-time-reverify-and-parallel-merge-ceiling`, Applied Answer q1 part
 * (a)). Spawned as its OWN node process via `tsx` from
 * `test/cross-job-concurrent-land.test.ts` so the in-process `integrateLock`
 * (per-`runOnce` keyed lock created in `run.ts`) CANNOT serialise the racers —
 * the ONLY cross-process serialiser is the CAS-loop in `performIntegration`'s
 * merge-push tail (`mergeRetries`), which is the load-bearing claim under test.
 *
 * The worker drives ONE integration end-to-end against a pre-claimed,
 * pre-branched, pre-edited working clone (the test seeds those steps in the
 * parent process so the race window is the push, not the build), with a
 * filesystem-rendezvous so both processes ARRIVE at the push concurrently
 * without any wall-clock dependency: each worker writes `ready-<slug>` into
 * the rendezvous dir and busy-polls until BOTH ready files exist, then
 * proceeds. Both processes enter the rebase+push step within a small window,
 * so the CAS loop arbitrates them.
 *
 * On completion the worker emits a single JSON line on stdout describing the
 * `performIntegration` outcome (`outcome`, `reason`, `routedToNeedsAttention`)
 * so the parent can assert external behaviour without reaching into the child's
 * lock refs (the lock refs themselves are still inspected from the parent
 * against the bare arbiter — that's the cross-substrate authority).
 */

import {readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performIntegration} from '../../src/integration-core.js';
import {mergeConfig} from '../../src/config.js';

interface WorkerArgs {
	cwd: string;
	slug: string;
	arbiter: string;
	mergeRetries: number;
	rendezvousDir: string;
	/** Wait until this many `ready-*` files exist (race rendezvous). */
	expectedReadyCount?: number;
}

async function pollUntil(
	predicate: () => boolean,
	timeoutMs: number,
	label: string,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error(`rendezvous timeout (${label})`);
		}
		await new Promise((r) => setTimeout(r, 5));
	}
}

async function main(): Promise<void> {
	const args = JSON.parse(process.argv[2]) as WorkerArgs;

	// The cap MUST flow through the same precedence chain `run.ts`/`complete.ts`
	// use (`mergeConfig`), not via a hard-coded kwarg — this is the
	// `merge-retries-gate-precedence` seam being load-bearing under the race.
	const resolved = mergeConfig({mergeRetries: args.mergeRetries});

	// Announce arrival.
	writeFileSync(join(args.rendezvousDir, `ready-${args.slug}`), 'ready');

	// Block until the race rendezvous condition fires.
	const want = args.expectedReadyCount ?? 2;
	await pollUntil(
		() =>
			readdirSync(args.rendezvousDir).filter((f) => f.startsWith('ready-'))
				.length >= want,
		30_000,
		`race ready-count >= ${want}`,
	);

	const result = await performIntegration({
		cwd: args.cwd,
		arbiter: args.arbiter,
		slug: args.slug,
		source: 'tasks-ready',
		recovering: false,
		verify: 'exit 0',
		mode: 'merge',
		surfaceArbiter: args.arbiter,
		// The fresh-worktree gate is the load-bearing re-verify the brief names;
		// pin it ON so the rebased-tip gate runs on every push attempt (incl. the
		// re-rebase after a non-fast-forward loser retry).
		freshWorktreeGate: true,
		mergeRetries: resolved.mergeRetries,
		// Deterministic, latency-free retries (no jitter sleep on the loser's
		// refetch loop) so the test is wall-clock-independent.
		mergeJitterMs: 0,
		env: process.env,
	});

	process.stdout.write(
		JSON.stringify({
			outcome: result.outcome,
			reason: result.reason ?? null,
			routedToNeedsAttention: result.routedToNeedsAttention,
		}),
	);
}

main().catch((err: unknown) => {
	const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
	process.stderr.write(msg + '\n');
	process.exit(1);
});
