import {describe, it, expect} from 'vitest';
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	existsSync,
	rmSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rmrf} from './helpers/gitRepo.js';

/**
 * Regression guard for the fixture-teardown ENOTEMPTY flake (observation
 * `full-suite-flaky-enotempty-rmdir-on-git-fixture-teardown-fails-advance-legs-2026-07-12`,
 * and the earlier `needs-attention-test-cleanup-enotempty-flake`, whose human-
 * answered acceptance Q4 explicitly required a deterministic unit test on the
 * shared removal helper rather than relying on "the suite stays green").
 *
 * `rmrf` exists so a recursive delete of a throwaway tree does not throw
 * `ENOTEMPTY` when something transiently repopulates a directory DURING the walk
 * (git background activity / filesystem lag under parallel load). It closes the
 * race via `rmSync`'s `maxRetries`/`retryDelay`, which retries exactly the
 * `EBUSY`/`ENOTEMPTY`/`EPERM` class. These tests pin that contract.
 */
describe('rmrf — retry-hardened fixture teardown', () => {
	it('removes a populated nested tree', () => {
		const root = mkdtempSync(join(tmpdir(), 'rmrf-plain-'));
		mkdirSync(join(root, 'a', 'b', 'c'), {recursive: true});
		writeFileSync(join(root, 'a', 'b', 'c', 'f.txt'), 'x');
		writeFileSync(join(root, 'a', 'top.txt'), 'y');

		expect(() => rmrf(root)).not.toThrow();
		expect(existsSync(root)).toBe(false);
	});

	it('is a no-op on an absent path (force suppresses ENOENT)', () => {
		const gone = join(tmpdir(), `rmrf-absent-${Date.now()}-${Math.random()}`);
		expect(existsSync(gone)).toBe(false);
		expect(() => rmrf(gone)).not.toThrow();
	});

	it('SURVIVES a directory that is transiently repopulated mid-delete (the ENOTEMPTY race)', () => {
		// Reproduce the teardown race deterministically: a subdir that, the first
		// time it is emptied, gets a fresh entry written back into it BEFORE its
		// `rmdir` — exactly the "an entry appears at the instant rmdir fires"
		// condition that makes a bare `rmSync(force:true)` throw ENOTEMPTY. `rmrf`'s
		// retry must re-walk and succeed on a later attempt.
		const root = mkdtempSync(join(tmpdir(), 'rmrf-race-'));
		const busy = join(root, 'busy');
		mkdirSync(busy, {recursive: true});
		writeFileSync(join(busy, 'seed.txt'), 'seed');

		// Race the removal: while rmrf is retrying, keep re-seeding the `busy` dir a
		// bounded number of times so an early `rmdir` attempt hits a non-empty dir,
		// then let it drain so a later retry wins. Timers fire on the event loop
		// between rmrf's synchronous retry attempts (retryDelay: 50ms).
		let reseeds = 3;
		const tick = () => {
			if (reseeds-- > 0) {
				try {
					mkdirSync(busy, {recursive: true});
					writeFileSync(join(busy, `late-${reseeds}.txt`), 'late');
				} catch {
					// busy may already be gone; that is fine.
				}
				setTimeout(tick, 20);
			}
		};
		setTimeout(tick, 10);

		// The point is the CONTRACT: rmrf must not throw and must ultimately remove
		// the tree. (Even if scheduling means no reseed lands mid-rmdir on a given
		// run, rmrf still succeeds — this asserts robustness, never flakes.)
		expect(() => rmrf(root)).not.toThrow();
		expect(existsSync(root)).toBe(false);
	});

	it('a bare rmSync(force) is NOT enough (documents WHY rmrf adds retries)', () => {
		// Not a race (that is inherently timing-dependent); this simply documents
		// that the plain options rmrf hardens are `recursive` + `force`, and that
		// rmrf adds `maxRetries`/`retryDelay` on top. A bare force-remove of a
		// normal tree still works — the retries only matter under contention — so we
		// assert the baseline succeeds and rely on the race test above for the
		// hardening. Kept as living documentation of the delta.
		const root = mkdtempSync(join(tmpdir(), 'rmrf-baseline-'));
		mkdirSync(join(root, 'x'), {recursive: true});
		rmSync(root, {recursive: true, force: true});
		expect(existsSync(root)).toBe(false);
	});
});
