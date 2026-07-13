<!-- dorfl-sidecar: item=observation:full-suite-flaky-enotempty-rmdir-on-git-fixture-teardown-fails-advance-legs-2026-07-12 type=observation slug=full-suite-flaky-enotempty-rmdir-on-git-fixture-teardown-fails-advance-legs-2026-07-12 allAnswered=false -->

Item: [`observation:full-suite-flaky-enotempty-rmdir-on-git-fixture-teardown-fails-advance-legs-2026-07-12`](../notes/observations/full-suite-flaky-enotempty-rmdir-on-git-fixture-teardown-fails-advance-legs-2026-07-12.md)

## Q1

**Should the ENOTEMPTY teardown-race fix be folded into the existing task 'harden-run-test-claimed-done-flaky-under-full-suite' (whose scope was already widened on 2026-07-12 to cover this class of teardown race), or promoted as its own dedicated task?**

> The observation explicitly defers this choice: 'A human decides whether to fold this into the existing harden-run-test-... task or promote a dedicated task; either way, the reproductions above are precise enough to act on.' The existing task's 'Related findings (folded in 2026-07-12)' section already references this observation and widens 'Done when' to require the ENOTEMPTY race to be gone across 20 runs.

_Suggested default: Fold into the existing hardening task — its widened scope already names this race and the least-invasive fix (reap git subprocs + bounded ENOTEMPTY retry in the shared cleanup helper) sits in the same test-helper file._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Should the SECOND flake noted here — the CAS/mergeRetries count-assertion flake in cross-job-concurrent-land.test.ts and merge-retries-external.test.ts ('expected 2 to be 1' / 'expected 2 to be <= 1' on job 86686290527) — be split off into its own observation now, or left as a side-note until it recurs?**

> The observation flags it explicitly: 'This is a CAS/merge-retry timing assertion, a DIFFERENT flake class from the ENOTEMPTY teardown race... Flagged for a separate look; do not fold it into the ENOTEMPTY fix.' It is currently only mentioned in-line and would otherwise be discharged when this observation resolves.

_Suggested default: Split it off into its own observation before this one is discharged, so the CAS/mergeRetries signal is not lost when the ENOTEMPTY teardown fix lands._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
