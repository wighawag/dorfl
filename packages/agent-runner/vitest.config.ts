import {defineConfig} from 'vitest/config';

/**
 * Two projects so the CLAIM-RACE tests don't flake.
 *
 * The four files below drive REAL git subprocesses and include in-process
 * two-claimer races (`Promise.all` of concurrent claims) against a local
 * `--bare` `file://` arbiter. The claim protocol itself is sound
 * (`--force-with-lease` + post-push verify), but git's `file://` transport does
 * NOT serialise concurrent pushes as atomically as a real remote's receive-pack,
 * so when these run CONCURRENTLY with the rest of the suite the CPU/IO pressure
 * widens the race window and the local sim occasionally lets both pushes
 * fast-forward (a harness artifact, NOT a product bug — confirmed: the suite
 * passes 100% of the time with file parallelism off, flakes ~1-in-3 with it on).
 *
 * Fix: run these git-heavy files in their OWN project with `fileParallelism:
 * false` (they run one-at-a-time, isolated from the parallel pressure), while the
 * fast pure-logic tests keep running in parallel. This keeps the gate
 * deterministic without slowing the whole suite or masking anything with retries.
 */
const RACE_SENSITIVE = [
	'test/claim-cas.test.ts',
	'test/start.test.ts',
	'test/work-on.test.ts',
	'test/run.test.ts',
	// Drives real git against a --bare arbiter AND writes main (surface-on-main
	// cherry-pick + resolve-via-start); keep it out of file-parallel pressure so
	// the main-CAS pushes stay deterministic.
	'test/needs-attention-surface-on-main.test.ts',
];

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: 'parallel',
					exclude: ['node_modules/**', 'dist/**', ...RACE_SENSITIVE],
				},
			},
			{
				test: {
					name: 'sequential',
					include: RACE_SENSITIVE,
					fileParallelism: false,
				},
			},
		],
	},
});
