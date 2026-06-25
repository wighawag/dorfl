<!-- dorfl-sidecar: item=observation:recursive-test-run-occasional-flake-2026-06-23 type=observation slug=recursive-test-run-occasional-flake-2026-06-23 allAnswered=false -->

## Q1

**What becomes of this signal: keep it as a noted watch-item, promote it to a slice that hardens the advance-ci-template / advance-lifecycle-template tests against parallel-execution flakes, or drop it?**

> work/notes/observations/recursive-test-run-occasional-flake-2026-06-23.md records one `pnpm -r test` run failing with 3 failures in the dorfl template tests (advance-ci-template / advance-lifecycle-template); an immediate `--filter dorfl test` rerun plus two more `pnpm -r test` runs all passed clean (178/178 files, 2585/2585 tests). It was captured as an in-scope side-output while working `fix-scan-json-brief-pool-jq-and-close-job-via` (confirmed in work/notes/observations/review-nits-fix-scan-json-brief-pool-jq-and-close-job-via-2026-06-23.md, which RATIFIES this note as a correctly-bucketed observation, not scope creep).
>
> Two things make the disposition genuinely open:
> 1) RECURRENCE BAR. This is one more member of an established 'green logic, racy under full-suite parallel load' family in work/notes/observations/ (run-internal-error-config-error-flakes-as-lost-race-under-load -> triaged KEEP; work-layout-guard-test-flaky-under-parallel-load; fresh-worktree-gate-test...; website-build-flakes-ldenv...; triage-cas-race-test-still-flakes... -> promoted only AFTER it recurred). The repo's settled bar is: KEEP on first sighting, promote a serialise/isolate slice on recurrence. By that bar this single observation is below the promotion threshold.
> 2) WEAKER EVIDENCE THAN ITS SIBLINGS. The note self-describes the failing assertions as 'ones my edit had just made pass' during the `fix-scan-json-brief-pool-jq-and-close-job-via` (`.prds[]` -> `.briefs[]`) change, and the advance-ci/lifecycle template tests are deterministic in-memory snapshot/structural-validation tests (test/advance-ci-template.test.ts; no shared arbiter/claim state, no `describe.sequential`), unlike the claim-race/CAS-race siblings. That makes a mid-edit stale-build / transient-state cause at least as plausible as a true parallel-execution race, so it is not even clearly the same flake class as its siblings. It names neither the 3 specific assertions nor whether a clean `pnpm -r build` preceded the failing run.

_Suggested default: KEEP as a watch-item (matches the repo's recurrence-based auto-triage bar and the sibling run-internal-error... KEEP precedent). Do not promote a slice on this single, evidentially-thin sighting; promote a test-isolation/serialise slice (mirroring the serialise-* precedents) only if these specific template tests flake again under parallel load. If kept, append the 3 failing assertion names and whether a clean build preceded the run on next recurrence so the eventual slice has a precise repro._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
