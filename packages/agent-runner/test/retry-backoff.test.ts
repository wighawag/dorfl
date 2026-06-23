import {describe, it, expect} from 'vitest';
import {
	retryWithBackoff,
	DEFAULT_BACKOFF,
	type Sleep,
} from '../src/retry-backoff.js';

/**
 * The shared bounded-exponential-backoff helper (task
 * `needs-attention-routing-resilient-honest-requeue-safe`). It must: retry a
 * failing op with a TEMPORAL delay (distinct from claim-cas's instant-contention
 * loop), grow the delay exponentially to a cap, give up cleanly after a bounded
 * budget (NEVER hang / NEVER throw out), and drive the WHOLE timeline through an
 * INJECTABLE sleep so tests assert the schedule with NO real wall-clock waits.
 */

/** A sleep seam that records the delays it was asked for (no real waiting). */
function recordingSleep(): {sleep: Sleep; delays: number[]} {
	const delays: number[] = [];
	return {
		sleep: async (ms: number) => {
			delays.push(ms);
		},
		delays,
	};
}

describe('retryWithBackoff', () => {
	it('returns the value on the first success with no sleeps', async () => {
		const {sleep, delays} = recordingSleep();
		const r = await retryWithBackoff(async () => ({ok: true, value: 42}), {
			sleep,
		});
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value).toBe(42);
			expect(r.attempts).toBe(1);
		}
		expect(delays).toEqual([]); // no retry → no sleep
	});

	it('retries a failing op then succeeds, sleeping between attempts', async () => {
		const {sleep, delays} = recordingSleep();
		let calls = 0;
		const r = await retryWithBackoff(
			async () => {
				calls++;
				if (calls < 3) {
					return {ok: false, error: 'unreachable'} as const;
				}
				return {ok: true, value: 'ok'} as const;
			},
			{sleep, initialDelayMs: 100, maxDelayMs: 10_000, maxTotalMs: 100_000},
		);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value).toBe('ok');
			expect(r.attempts).toBe(3);
		}
		// Two failures → two inter-attempt sleeps, exponential: 100, 200.
		expect(delays).toEqual([100, 200]);
	});

	it('grows the delay exponentially up to the cap', async () => {
		const {sleep, delays} = recordingSleep();
		await retryWithBackoff(async () => ({ok: false, error: 'down'}), {
			sleep,
			initialDelayMs: 100,
			maxDelayMs: 400,
			maxTotalMs: 10_000,
			maxAttempts: 6,
		});
		// 100, 200, 400 (capped), 400, 400 — never exceeds the cap.
		expect(delays).toEqual([100, 200, 400, 400, 400]);
	});

	it('gives up cleanly after maxAttempts (bounded — never hangs)', async () => {
		const {sleep, delays} = recordingSleep();
		let calls = 0;
		const r = await retryWithBackoff(
			async () => {
				calls++;
				return {ok: false, error: 'still down'} as const;
			},
			{
				sleep,
				initialDelayMs: 1,
				maxDelayMs: 1,
				maxTotalMs: 1_000_000,
				maxAttempts: 4,
			},
		);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.attempts).toBe(4);
			expect(r.lastError).toBe('still down');
		}
		expect(calls).toBe(4);
		expect(delays).toHaveLength(3); // 4 attempts → 3 inter-attempt sleeps
	});

	it('gives up once the next delay would exceed the total budget', async () => {
		const {sleep, delays} = recordingSleep();
		const r = await retryWithBackoff(async () => ({ok: false, error: 'down'}), {
			sleep,
			initialDelayMs: 100,
			maxDelayMs: 100_000,
			maxTotalMs: 250, // 100 + 200 = 300 > 250 → stop before the 2nd sleep
			maxAttempts: 100,
		});
		expect(r.ok).toBe(false);
		// First sleep 100 (elapsed 100); next would be 200 → 300 > 250 → stop.
		expect(delays).toEqual([100]);
	});

	it('treats a THROWN op as a failed attempt (caught, never escapes)', async () => {
		const {sleep, delays} = recordingSleep();
		let calls = 0;
		const r = await retryWithBackoff(
			async () => {
				calls++;
				if (calls < 2) {
					throw new Error('git fetch failed (exit 128): could not read');
				}
				return {ok: true, value: 'recovered'} as const;
			},
			{sleep, initialDelayMs: 5, maxAttempts: 4},
		);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value).toBe('recovered');
		}
		expect(delays).toEqual([5]);
	});

	it('reports the thrown message as lastError on give-up', async () => {
		const {sleep} = recordingSleep();
		const r = await retryWithBackoff(
			async () => {
				throw new Error('boom');
			},
			{sleep, maxAttempts: 2, initialDelayMs: 1},
		);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.lastError).toBe('boom');
		}
	});

	it('exposes sensible bounded defaults (asserted)', () => {
		expect(DEFAULT_BACKOFF).toEqual({
			initialDelayMs: 500,
			maxDelayMs: 8_000,
			maxTotalMs: 30_000,
			maxAttempts: 6,
		});
	});
});
