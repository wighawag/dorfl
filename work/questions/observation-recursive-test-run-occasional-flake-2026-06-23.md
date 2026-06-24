<!-- dorfl-sidecar: item=observation:recursive-test-run-occasional-flake-2026-06-23 type=observation slug=recursive-test-run-occasional-flake-2026-06-23 allAnswered=false -->

## Q1

**What becomes of this observation about a single, non-reproducible `pnpm -r test` flake in `dorfl` template tests (advance-ci-template / advance-lifecycle-template) seen once on 2026-06-23?**

> Body: one `pnpm -r test` run failed with 3 failures in dorfl template tests during work on `fix-scan-json-brief-pool-jq-and-close-job-via`; an immediate `--filter dorfl test` rerun and two subsequent `pnpm -r test` runs all passed clean (178/178 files, 2585/2585 tests). The author characterises it as a transient parallel-execution flake — the failing assertions were ones their edit had just made pass — and explicitly says 'not a real regression'. No reproducer, no stack trace captured, no follow-up signal recorded since. Sibling observations exist for other flakes (e.g. `needs-attention-test-cleanup-enotempty-flake.md`, `fresh-worktree-gate-test-gatesandboxcount-flaky-under-parallel-load.md`) — so test-flake under parallel `pnpm -r` load is a recurring background theme rather than unique to this signal. Files involved: packages/dorfl/test/advance-ci-template.test.ts, packages/dorfl/test/advance-lifecycle-template.test.ts.

_Suggested default: keep — single non-reproducible flake with no captured artefact; not enough to justify a task on its own, but worth leaving as a tally mark alongside the other parallel-test-load flake observations so a pattern (or its absence) can be judged later. Promote to a task only if a second occurrence in these same template tests lands._

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):
