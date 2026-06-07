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
	// The slicing concurrency lock reuses the claim CAS (prd → slicing/ → prd)
	// against a --bare arbiter and runs an in-process two-slicer race plus a
	// release-rebase-conflict test that writes main; keep it out of file-parallel
	// pressure for the same deterministic claim/main-CAS reasoning as claim-cas.
	'test/slicing-lock.test.ts',
	'test/start.test.ts',
	'test/work-on.test.ts',
	'test/run.test.ts',
	// `do <slug>` drives real git against a --bare arbiter, runs in-process
	// two-doer races, AND writes main (the autonomous needs-attention surfacing);
	// keep it out of file-parallel pressure so the claim/main-CAS stays
	// deterministic (same reasoning as start/run/needs-attention-surface).
	'test/do.test.ts',
	// The main-divergence guard + non-fatal local-main sync: drives real git
	// against a --bare arbiter, diverges local main, and writes main (the merge-mode
	// integration + autonomous surfacing); keep it out of file-parallel pressure for
	// the same deterministic claim/main-CAS reasoning as do.test.ts.
	'test/main-divergence-guard.test.ts',
	// `do --watch` drives real git against a --bare arbiter, writes main, AND
	// launches a stubbed pi (async spawn) whose session .jsonl is tailed
	// concurrently; keep it out of file-parallel pressure for the same reason as
	// do.test.ts (deterministic claim/main-CAS).
	'test/do-watch.test.ts',
	// `do --remote <r>` materialises a hub mirror + job worktree in a temp agents'
	// area, runs the pipeline against the worktree, AND writes main (the autonomous
	// needs-attention surfacing) against a --bare arbiter; keep it out of
	// file-parallel pressure for the same deterministic claim/main-CAS reasoning as
	// do.test.ts.
	'test/do-remote.test.ts',
	// `do --review --watch` drives real git against a --bare arbiter, writes main
	// (approve→merge / block→needs-attention surfacing), AND launches a stubbed pi
	// (async spawn) for BOTH the build and the review, whose session .jsonl files
	// are tailed concurrently; keep it out of file-parallel pressure for the same
	// reason as do-watch.test.ts (deterministic claim/main-CAS).
	'test/watch-review-session.test.ts',
	// Drives real git against a --bare arbiter AND writes main (surface-on-main
	// cherry-pick + resolve-via-start); keep it out of file-parallel pressure so
	// the main-CAS pushes stay deterministic.
	'test/needs-attention-surface-on-main.test.ts',
	// Drives real git against a --bare arbiter AND writes main (the consolidated
	// bounce push + on-main surface); same determinism reasoning as above.
	'test/centralise-bounce-branch-push.test.ts',
	// Gate 2 (PR/code review) on the do/complete path: drives real git against a
	// --bare arbiter, integrates/merges on approve, AND writes main (the autonomous
	// needs-attention surfacing on a block); keep it out of file-parallel pressure
	// for the same deterministic claim/main-CAS reasoning as do.test.ts.
	'test/review-gate-pr.test.ts',
	// The shared gate→integrate core (Slice 1 of the run/do convergence): drives
	// real git against a --bare arbiter, integrates/merges on approve (writes main),
	// and routes failures; keep it out of file-parallel pressure for the same
	// deterministic claim/main-CAS reasoning as review-gate-pr.test.ts.
	'test/integration-core.test.ts',
	// `run` routed through the shared core (Slice 2 of the run/do convergence): the
	// fleet's review gate + PR title/body + per-repo verify proofs. Drives real git
	// against a --bare arbiter, integrates/merges on approve (writes main), and
	// routes failures (the needs-attention surfacing); keep it out of file-parallel
	// pressure for the same deterministic claim/main-CAS reasoning as run.test.ts.
	'test/run-integration-core.test.ts',
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
