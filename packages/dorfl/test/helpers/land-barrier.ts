import {
	integrationLand,
	type IntegrationCoreResult,
	type IntegrationLandInput,
} from '../../src/integration-core.js';

/**
 * A BARRIER on the land half of the merge tail, for the negative race controls
 * ("without the lock AND without the retry, two same-base merges do NOT both
 * land"). Those controls only prove what they claim when every racer has done
 * its step-4 fetch+rebase against the SAME stale `<arbiter>/main` before ANY of
 * them pushes. Left to the scheduler, one racer can finish its whole tail
 * (fetch, rebase, push) before the other fetches; the other then rebases onto
 * the advanced main and lands legitimately, and the control flakes red (task
 * `deflake-the-integration-core-control-and-two-load-timeouts`).
 *
 * It wraps the process-wide {@link integrationLand} seam (the same object the CI
 * phase recorder swaps), which `performIntegration` calls AFTER its step-4
 * rebase (and after the fresh-worktree gate, when on) and BEFORE the first
 * `${branch}:main` push. So "every racer is parked at the land seam" means
 * "every racer rebased onto the same base and none has pushed yet". The product
 * code is untouched: this changes only WHEN the land half starts, never what
 * it does.
 */

/**
 * Wrap every land-half call with `around(input, land)`, where `land` is the real
 * land half. The shared primitive: the in-process {@link holdLandsUntilAllRebased}
 * and the cross-process worker (a filesystem rendezvous) both build on it.
 * Returns the restore function; call it in a `finally`.
 */
export function installLandGate(
	around: (
		input: IntegrationLandInput,
		land: (input: IntegrationLandInput) => Promise<IntegrationCoreResult>,
	) => Promise<IntegrationCoreResult>,
): () => void {
	const original = integrationLand.land;
	integrationLand.land = (input) => around(input, original);
	return () => {
		integrationLand.land = original;
	};
}

export interface HeldLands {
	/** The slugs in the order they were RELEASED to land (= arrival order). */
	readonly order: string[];
	/** Restore the real land seam (idempotent). Call it in a `finally`. */
	restore(): void;
}

/**
 * In-process barrier: park every land-half call until `expected` racers have
 * arrived (all rebased onto the same base, none pushed), then release them ONE
 * AT A TIME in arrival order, each only after the previous land settled. The
 * interleaving is therefore fixed: the first released racer's push lands; every
 * later one pushes a branch rebased onto the now-stale base, so its push is
 * non-fast-forward, and whether it then lands is decided ONLY by the product's
 * retry (`mergeRetries`), never by scheduling.
 *
 * If fewer than `expected` racers reach the land seam within `timeoutMs` (one
 * routed earlier, e.g. a first-rebase conflict), the parked ones are rejected
 * with a clear error instead of hanging the test until the vitest timeout.
 */
export function holdLandsUntilAllRebased(
	expected: number,
	timeoutMs = 20_000,
): HeldLands {
	interface Parked {
		slug: string;
		go: () => void;
		fail: (err: Error) => void;
		settled: Promise<void>;
	}
	const parked: Parked[] = [];
	const order: string[] = [];
	const timer = setTimeout(() => {
		const err = new Error(
			`land barrier: only ${parked.length} of ${expected} integrations ` +
				`reached the land seam within ${timeoutMs}ms`,
		);
		for (const p of parked) p.fail(err);
	}, timeoutMs);
	timer.unref?.();

	const releaseInArrivalOrder = async (): Promise<void> => {
		clearTimeout(timer);
		for (const p of parked) {
			order.push(p.slug);
			p.go();
			await p.settled;
		}
	};

	const restoreSeam = installLandGate(async (input, land) => {
		let go!: () => void;
		let fail!: (err: Error) => void;
		const released = new Promise<void>((resolve, reject) => {
			go = resolve;
			fail = reject;
		});
		let markSettled!: () => void;
		const settled = new Promise<void>((resolve) => {
			markSettled = resolve;
		});
		parked.push({slug: input.slug, go, fail, settled});
		if (parked.length === expected) {
			void releaseInArrivalOrder();
		}
		await released;
		try {
			return await land(input);
		} finally {
			markSettled();
		}
	});
	return {
		order,
		restore: () => {
			clearTimeout(timer);
			restoreSeam();
		},
	};
}
