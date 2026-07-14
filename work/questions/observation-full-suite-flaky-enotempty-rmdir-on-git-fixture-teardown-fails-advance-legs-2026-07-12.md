<!-- dorfl-sidecar: item=observation:full-suite-flaky-enotempty-rmdir-on-git-fixture-teardown-fails-advance-legs-2026-07-12 type=observation slug=full-suite-flaky-enotempty-rmdir-on-git-fixture-teardown-fails-advance-legs-2026-07-12 allAnswered=false -->

Item: [`observation:full-suite-flaky-enotempty-rmdir-on-git-fixture-teardown-fails-advance-legs-2026-07-12`](../notes/observations/full-suite-flaky-enotempty-rmdir-on-git-fixture-teardown-fails-advance-legs-2026-07-12.md)

## Q1

**Should the ENOTEMPTY teardown-race fix be folded into the existing task 'harden-run-test-claimed-done-flaky-under-full-suite' (whose scope was already widened on 2026-07-12 to cover this class of teardown race), or promoted as its own dedicated task?**

> The observation explicitly defers this choice: 'A human decides whether to fold this into the existing harden-run-test-... task or promote a dedicated task; either way, the reproductions above are precise enough to act on.' The existing task's 'Related findings (folded in 2026-07-12)' section already references this observation and widens 'Done when' to require the ENOTEMPTY race to be gone across 20 runs.

_Suggested default: Fold into the existing hardening task — its widened scope already names this race and the least-invasive fix (reap git subprocs + bounded ENOTEMPTY retry in the shared cleanup helper) sits in the same test-helper file._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Moot / resolve: the fix has since LANDED in the shared test-helper (the least-invasive option this question anticipated), so there is no longer a fold-vs-promote choice to make. A retry-hardened `rmrf(path)` now backs `Scratch.cleanup()` and git auto-gc is disabled in the fixture env, killing the ENOTEMPTY teardown race at the root (commits `7eefb8e7`, `4fb7d87d`, `02d18ce8`; `packages/dorfl/test/helpers/gitRepo.ts:181,206`). Keep this note on record as the durable rationale the `rmrf` docstring and `rmrf-teardown.test.ts` cite; do not delete it (that would dangle a live-source reference).

## Q2

**Should the SECOND flake noted here — the CAS/mergeRetries count-assertion flake in cross-job-concurrent-land.test.ts and merge-retries-external.test.ts ('expected 2 to be 1' / 'expected 2 to be <= 1' on job 86686290527) — be split off into its own observation now, or left as a side-note until it recurs?**

> The observation flags it explicitly: 'This is a CAS/merge-retry timing assertion, a DIFFERENT flake class from the ENOTEMPTY teardown race... Flagged for a separate look; do not fold it into the ENOTEMPTY fix.' It is currently only mentioned in-line and would otherwise be discharged when this observation resolves.

_Suggested default: Split it off into its own observation before this one is discharged, so the CAS/mergeRetries signal is not lost when the ENOTEMPTY teardown fix lands._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Do NOT mint a new observation. This CAS/mergeRetries count-assertion flake (`cross-job-concurrent-land.test.ts`, `merge-retries-external.test.ts`: `expected 2 to be 1` / `expected 2 to be <= 1`) is the SAME flake family already captured by `observation:integration-core-serialisation-load-bearing-flake-2026-07-13` (a scheduling-sensitive assertion on the same concurrent-merge / CAS-retry machinery under full-suite parallel load). Fold it there: widen that note to name these two test files alongside `integration-core.test.ts` as one flake family, so the signal is preserved when this ENOTEMPTY note resolves. Treat this Q2 as duplicate -> `integration-core-serialisation-load-bearing-flake-2026-07-13`.
