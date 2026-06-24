/**
 * A small, shared **bounded exponential-backoff** retry helper for git / provider
 * NETWORK ops on the needs-attention route (the OBSERVABLE surface push, the
 * RECOVERABLE branch push, and the propose-mode PR create). The route does a
 * LOCAL move that always succeeds offline, then these best-effort remote ops; a
 * transient OUTAGE (unreachable arbiter / flaky provider) should be RETRIED a few
 * times with a temporal delay before a clean BOUNDED give-up into the local-only
 * degraded state — never an indefinite hang, never an uncaught throw out of the
 * failure handler.
 *
 * This is DELIBERATELY NOT the model in {@link file://./claim-cas.ts}: that loop
 * retries CONTENTION (a REJECTED push — someone advanced the ref) INSTANTLY with
 * NO delay, refetching+rebuilding against the new base. THIS helper is for the
 * OUTAGE/unreachable case, which needs a temporal back-off (the remote may come
 * back); the two are distinct and must not be conflated.
 *
 * Bounds (all configurable, sensible defaults):
 *   - `initialDelayMs` (X): the first inter-attempt delay.
 *   - `maxDelayMs` (Y): the cap the exponentially-growing delay never exceeds.
 *   - `maxTotalMs` (Z): the wall-clock budget; once the NEXT delay would push the
 *     cumulative sleep past this, we stop retrying (a clean bounded give-up).
 *   - `maxAttempts`: a hard upper bound on attempts (a belt-and-braces cap so a
 *     tiny/zero delay budget still terminates).
 *
 * The SLEEP is INJECTABLE (reusing the `sleep?: (ms) => Promise<void>` /
 * `realSleep` seam `src/run.ts` already uses for the inter-tick sleep) so tests
 * drive the whole retry TIMELINE deterministically with NO real wall-clock waits.
 *
 * Model-endpoint retries are NOT this helper's job — the pi harness retries its
 * own API. This is git/provider network resilience only.
 */

/** A sleep seam: resolve after `ms`. The real one is `setTimeout`-backed. */
export type Sleep = (ms: number) => Promise<void>;

/** The default real sleep (a `setTimeout`-backed promise). */
export const realSleep: Sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/** Bounds for {@link retryWithBackoff}. All optional; defaults below. */
export interface BackoffOptions {
	/** First inter-attempt delay (ms). Default {@link DEFAULT_BACKOFF}.initialDelayMs. */
	initialDelayMs?: number;
	/** Exponential-growth cap (ms). Default {@link DEFAULT_BACKOFF}.maxDelayMs. */
	maxDelayMs?: number;
	/** Total wall-clock budget for delays (ms). Default {@link DEFAULT_BACKOFF}.maxTotalMs. */
	maxTotalMs?: number;
	/** Hard attempt cap. Default {@link DEFAULT_BACKOFF}.maxAttempts. */
	maxAttempts?: number;
	/** Injected sleep (tests). Default {@link realSleep}. */
	sleep?: Sleep;
}

/**
 * The default bounds: a short first delay growing exponentially to a modest cap,
 * with a small total budget — enough to ride out a blip, NOT a hang. A clean
 * bounded give-up into the local-only degraded state beats waiting forever;
 * CI/humans then retry deliberately.
 */
export const DEFAULT_BACKOFF: Required<Omit<BackoffOptions, 'sleep'>> = {
	initialDelayMs: 500,
	maxDelayMs: 8_000,
	maxTotalMs: 30_000,
	maxAttempts: 6,
};

/** Outcome of {@link retryWithBackoff}: the op's value, or a clean give-up. */
export type RetryResult<T> =
	| {ok: true; value: T; attempts: number}
	| {ok: false; attempts: number; lastError?: string};

/**
 * Run `op` and, if it reports failure, RETRY it with bounded exponential backoff
 * until it succeeds or the bounds are exhausted (then a clean give-up — NEVER an
 * indefinite loop). `op` reports failure in EITHER of two ways, both treated the
 * same so callers can use whichever fits the underlying API:
 *
 *   - it RETURNS `{ok: false, error?}` (e.g. a git `RunResult` mapped to a
 *     boolean — a non-zero exit is a failure, not a throw), OR
 *   - it THROWS (e.g. a git plumbing helper's hard-fetch against an unreachable
 *     remote) — the throw is CAUGHT here and treated as a failed attempt.
 *
 * On success it returns `{ok: true, value}`. On exhaustion it returns
 * `{ok: false, lastError}` — it NEVER throws out (the route must not crash on a
 * git outage). The delay schedule is `initialDelayMs`, doubling each attempt up
 * to `maxDelayMs`, stopping once another attempt's delay would exceed the
 * `maxTotalMs` budget or `maxAttempts` is reached.
 */
export async function retryWithBackoff<T>(
	op: () => Promise<{ok: true; value: T} | {ok: false; error?: string}>,
	options: BackoffOptions = {},
): Promise<RetryResult<T>> {
	const initialDelayMs =
		options.initialDelayMs ?? DEFAULT_BACKOFF.initialDelayMs;
	const maxDelayMs = options.maxDelayMs ?? DEFAULT_BACKOFF.maxDelayMs;
	const maxTotalMs = options.maxTotalMs ?? DEFAULT_BACKOFF.maxTotalMs;
	const maxAttempts = options.maxAttempts ?? DEFAULT_BACKOFF.maxAttempts;
	const sleep = options.sleep ?? realSleep;

	let attempts = 0;
	let elapsed = 0;
	let delay = initialDelayMs;
	let lastError: string | undefined;

	// eslint-disable-next-line no-constant-condition
	while (true) {
		attempts++;
		try {
			const r = await op();
			if (r.ok) {
				return {ok: true, value: r.value, attempts};
			}
			lastError = r.error;
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
		}

		// Decide whether ANOTHER attempt is allowed (bounded give-up, not a hang).
		if (attempts >= maxAttempts) {
			return {ok: false, attempts, lastError};
		}
		if (elapsed + delay > maxTotalMs) {
			return {ok: false, attempts, lastError};
		}

		await sleep(delay);
		elapsed += delay;
		delay = Math.min(delay * 2, maxDelayMs);
	}
}
