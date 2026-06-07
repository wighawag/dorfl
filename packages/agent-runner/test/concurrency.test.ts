import {describe, it, expect} from 'vitest';
import {runConcurrent, createKeyedLock} from '../src/concurrency.js';

/** A deferred whose `resolve` is callable from the outside (a manual latch). */
function deferred<T = void>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return {promise, resolve};
}

describe('runConcurrent — bounded-concurrency executor (the loop/tick scheduler)', () => {
	it('returns results in INPUT order regardless of completion order', async () => {
		const items = [10, 30, 20];
		const results = await runConcurrent({
			items,
			maxInFlight: 3,
			keyFor: () => 'k',
			perKeyMax: 3,
			worker: async (n) => {
				await new Promise((r) => setTimeout(r, n));
				return n * 2;
			},
		});
		// Each slot is a settled result: {ok} on success, {error} on a throw.
		expect(results).toEqual([{ok: 20}, {ok: 60}, {ok: 40}]);
	});

	it('runs GENUINELY concurrently up to maxInFlight (multiple workers in flight at once)', async () => {
		let inFlight = 0;
		let peak = 0;
		const gate = deferred();
		const items = [1, 2, 3, 4];
		const promise = runConcurrent({
			items,
			maxInFlight: 4,
			keyFor: () => 'k',
			perKeyMax: 99,
			worker: async () => {
				inFlight++;
				peak = Math.max(peak, inFlight);
				await gate.promise; // hold every worker open simultaneously
				inFlight--;
				return null;
			},
		});
		// All four must be admitted before any completes — that is real concurrency.
		await waitFor(() => inFlight === 4);
		expect(peak).toBe(4);
		gate.resolve();
		await promise;
	});

	it('caps GLOBAL in-flight at maxInFlight (the 5th waits for a slot)', async () => {
		let inFlight = 0;
		let peak = 0;
		const gate = deferred();
		const items = [1, 2, 3, 4, 5];
		const promise = runConcurrent({
			items,
			maxInFlight: 2,
			keyFor: () => 'k',
			perKeyMax: 99,
			worker: async () => {
				inFlight++;
				peak = Math.max(peak, inFlight);
				await gate.promise;
				inFlight--;
				return null;
			},
		});
		await waitFor(() => inFlight === 2);
		// Give a stuck 3rd worker a chance to (wrongly) start — it must not.
		await new Promise((r) => setTimeout(r, 30));
		expect(inFlight).toBe(2);
		expect(peak).toBe(2);
		gate.resolve();
		await promise;
		expect(peak).toBe(2);
	});

	it('caps PER-KEY in-flight at perKeyMax even when a global slot is free', async () => {
		// Two repos (keys a, b). Global cap 4, per-key cap 1 → at most ONE of each
		// repo runs at a time, so peak per key is 1 (not 2) even with free slots.
		const inFlight = new Map<string, number>();
		const peak = new Map<string, number>();
		const gate = deferred();
		const items = [
			{key: 'a', id: 1},
			{key: 'a', id: 2},
			{key: 'b', id: 3},
			{key: 'b', id: 4},
		];
		const promise = runConcurrent({
			items,
			maxInFlight: 4,
			keyFor: (it) => it.key,
			perKeyMax: 1,
			worker: async (it) => {
				inFlight.set(it.key, (inFlight.get(it.key) ?? 0) + 1);
				peak.set(
					it.key,
					Math.max(peak.get(it.key) ?? 0, inFlight.get(it.key)!),
				);
				await gate.promise;
				inFlight.set(it.key, inFlight.get(it.key)! - 1);
				return null;
			},
		});
		// One of each repo runs concurrently (2 total in flight), never 2 of one repo.
		await waitFor(
			() => (inFlight.get('a') ?? 0) + (inFlight.get('b') ?? 0) === 2,
		);
		await new Promise((r) => setTimeout(r, 30));
		expect(peak.get('a')).toBe(1);
		expect(peak.get('b')).toBe(1);
		gate.resolve();
		await promise;
	});

	it('isolates worker failures: one rejecting worker does not abort the others', async () => {
		const items = [1, 2, 3];
		const results = await runConcurrent({
			items,
			maxInFlight: 3,
			keyFor: () => 'k',
			perKeyMax: 3,
			worker: async (n) => {
				if (n === 2) {
					throw new Error('boom');
				}
				return n;
			},
		});
		// The throwing item surfaces as a rejection slot; the rest still resolve —
		// the caller decides what a rejection means (run maps it to a result).
		expect(results[0]).toEqual({ok: 1});
		expect(results[1]).toMatchObject({error: expect.any(Error)});
		expect(results[2]).toEqual({ok: 3});
	});

	it('handles an empty item list (no work, resolves to [])', async () => {
		const results = await runConcurrent({
			items: [],
			maxInFlight: 4,
			keyFor: () => 'k',
			perKeyMax: 2,
			worker: async () => null,
		});
		expect(results).toEqual([]);
	});
});

describe('createKeyedLock — per-key serialiser (the per-repo claim guard)', () => {
	it('serialises critical sections for the SAME key (no overlap)', async () => {
		const lock = createKeyedLock();
		let active = 0;
		let overlapSeen = false;
		const section = async () => {
			active++;
			if (active > 1) {
				overlapSeen = true;
			}
			await new Promise((r) => setTimeout(r, 10));
			active--;
		};
		await Promise.all([
			lock('repo', section),
			lock('repo', section),
			lock('repo', section),
		]);
		expect(overlapSeen).toBe(false);
	});

	it('lets DIFFERENT keys run concurrently (no cross-key blocking)', async () => {
		const lock = createKeyedLock();
		let active = 0;
		let peak = 0;
		const section = async () => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((r) => setTimeout(r, 10));
			active--;
		};
		await Promise.all([lock('a', section), lock('b', section)]);
		expect(peak).toBe(2);
	});

	it('releases the lock even when a critical section THROWS', async () => {
		const lock = createKeyedLock();
		const order: string[] = [];
		const first = lock('k', async () => {
			order.push('first-start');
			throw new Error('boom');
		}).catch(() => order.push('first-rejected'));
		const second = lock('k', async () => {
			order.push('second-ran');
		});
		await Promise.all([first, second]);
		// The throwing first holder still released the lock so the second ran.
		expect(order).toContain('second-ran');
		expect(order).toContain('first-rejected');
	});
});

/** Poll until `predicate()` holds, or throw after `timeoutMs`. */
async function waitFor(
	predicate: () => boolean,
	timeoutMs = 1000,
): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error('waitFor timed out');
		}
		await new Promise((r) => setTimeout(r, 5));
	}
}
