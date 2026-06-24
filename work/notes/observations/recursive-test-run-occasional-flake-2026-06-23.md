---
needsAnswers: true
---

# `pnpm -r test` occasional flake (2026-06-23)

While working `fix-scan-json-brief-pool-jq-and-close-job-via`, one `pnpm -r test` run failed with 3 failures in `dorfl` template tests (advance-ci-template / advance-lifecycle-template), but an immediate `--filter dorfl test` rerun and two subsequent `pnpm -r test` runs all passed clean (178/178 files, 2585/2585 tests). Looked like a transient parallel-execution flake (the failing assertions were ones my edit had just made pass), not a real regression. Noting for signal; not in this task's scope.
