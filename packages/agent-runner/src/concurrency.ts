/**
 * A small, dependency-free bounded-concurrency scheduler — the reusable
 * execution engine of `run`'s concurrent tick.
 *
 * The `run` daemon's whole reason to exist (vs `do`) is running MULTIPLE agents
 * in parallel on non-interacting slices across the registry (ADR §3). The tick
 * therefore needs to run up to `maxParallel` jobs IN FLIGHT at once, capped at
 * `perRepoMax` concurrently per repo — and those caps must bound ACTUAL in-flight
 * execution, not just selection (the historical `runOnce` selected up to the caps
 * but then ran the jobs one-at-a-time in a `for…await` loop).
 *
 * This module owns ONLY scheduling/concurrency; it is intentionally ignorant of
 * what a "job" is. That keeps the loop and the tick separable (the advance-loop
 * forward-pointer): the loop owns concurrency/scheduling (here), the worker owns
 * one item's work (today `runOneItem`; tomorrow a swappable advance tick).
 *
 * It NEVER rejects: each item resolves to a settled slot — `{ok: T}` on success
 * or `{error: unknown}` on a worker throw — so one failing job can never abort the
 * others (a hard requirement: a conflicting rebase must route only ITS job to
 * needs-attention, never sink the batch). Results are returned in INPUT order.
 */

/** A settled outcome for one scheduled item. */
export type Settled<T> = {ok: T} | {error: unknown};

export interface RunConcurrentOptions<I, T> {
	/** The work items, in priority order (results come back in this order). */
	items: readonly I[];
	/** Global cap on workers in flight at once (the daemon's `maxParallel`). */
	maxInFlight: number;
	/** Group key for an item (the repo path) — bounds per-group concurrency. */
	keyFor: (item: I) => string;
	/** Per-key cap on workers in flight at once (the daemon's `perRepoMax`). */
	perKeyMax: number;
	/** Do one item's work. May reject; the rejection is captured, not propagated. */
	worker: (item: I) => Promise<T>;
}

/**
 * Run `worker` over `items` with at most `maxInFlight` in flight globally AND at
 * most `perKeyMax` in flight per `keyFor(item)`. Both caps bound REAL in-flight
 * execution. Returns a settled slot per item, in input order.
 *
 * Scheduling is greedy + work-conserving: whenever a slot frees, it admits the
 * earliest not-yet-started item whose key is under its per-key cap (skipping —
 * not blocking on — items whose repo is momentarily saturated, so one busy repo
 * cannot stall others holding free global slots).
 */
/**
 * A per-key async serialiser: `withKeyedLock(key, fn)` runs `fn` to completion
 * before the next caller for the SAME key starts; different keys never block each
 * other. Used to serialise the brief, shared-working-tree CLAIM step PER REPO
 * inside the otherwise-concurrent tick.
 *
 * Two concurrent claims in ONE repo would prepare their claim micro-commit in the
 * SAME working checkout (`git checkout -b` / `git mv` / `git commit` mutate the
 * shared HEAD + index), corrupting each other ("claim commit is a no-op" / a
 * failed commit) — a real worktree-isolation hazard, NOT the arbiter CAS the
 * slice expects to serialise winners. The claim is cheap (mv + commit + a CAS
 * push), so serialising it per repo is not the integration bottleneck the slice
 * warns against; the expensive agent run + the rebase-or-abort integration stay
 * fully concurrent (each runs in its OWN job worktree). Distinct repos still claim
 * in parallel (distinct cwd ⇒ no contention).
 */
export function createKeyedLock(): <T>(
	key: string,
	fn: () => Promise<T>,
) => Promise<T> {
	// Per key, a tail promise; chaining onto it serialises that key's critical
	// sections while leaving other keys independent.
	const tails = new Map<string, Promise<unknown>>();
	return function withKeyedLock<T>(
		key: string,
		fn: () => Promise<T>,
	): Promise<T> {
		const prior = tails.get(key) ?? Promise.resolve();
		// Run `fn` only after the prior holder settles (success OR failure — a thrown
		// critical section must still release the lock for the next caller).
		const run = prior.catch(() => {}).then(() => fn());
		// The tail tracks completion (never rejection) so the chain keeps flowing.
		tails.set(
			key,
			run.then(
				() => {},
				() => {},
			),
		);
		return run;
	};
}

export async function runConcurrent<I, T>(
	options: RunConcurrentOptions<I, T>,
): Promise<Array<Settled<T>>> {
	const {items, maxInFlight, keyFor, perKeyMax, worker} = options;
	const results = new Array<Settled<T>>(items.length);
	const started = new Array<boolean>(items.length).fill(false);
	const inFlightByKey = new Map<string, number>();
	let globalInFlight = 0;
	let completed = 0;

	if (items.length === 0) {
		return results;
	}

	return new Promise<Array<Settled<T>>>((resolve) => {
		/** Admit as many eligible items as the caps currently allow. */
		const pump = (): void => {
			for (let i = 0; i < items.length; i++) {
				if (globalInFlight >= maxInFlight) {
					break;
				}
				if (started[i]) {
					continue;
				}
				const key = keyFor(items[i]);
				const keyInFlight = inFlightByKey.get(key) ?? 0;
				if (keyInFlight >= perKeyMax) {
					continue; // this repo is saturated — skip, do not block the batch
				}
				start(i, key);
			}
		};

		const start = (i: number, key: string): void => {
			started[i] = true;
			globalInFlight++;
			inFlightByKey.set(key, (inFlightByKey.get(key) ?? 0) + 1);
			void Promise.resolve()
				.then(() => worker(items[i]))
				.then(
					(value) => finish(i, key, {ok: value}),
					(error) => finish(i, key, {error}),
				);
		};

		const finish = (i: number, key: string, slot: Settled<T>): void => {
			results[i] = slot;
			globalInFlight--;
			inFlightByKey.set(key, (inFlightByKey.get(key) ?? 1) - 1);
			completed++;
			if (completed === items.length) {
				resolve(results);
				return;
			}
			pump();
		};

		pump();
	});
}
