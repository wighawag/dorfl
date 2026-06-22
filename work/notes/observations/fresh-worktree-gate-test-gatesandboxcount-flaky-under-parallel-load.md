---
title: fresh-worktree-gate.test.ts gateSandboxCount() assertions flake under full-suite parallel load
date: 2026-06-22
status: open
---

## Signal (spotted, unverified root cause)

While driving the rename tasks (`drive-tasks` conductor, Gate-3 re-verify of the docs-only PR #208 `rename-docs-prose-slicing-to-tasking`), the FULL `pnpm -r test` suite failed with **2 failed / 2583 passed**, both in `test/fresh-worktree-gate.test.ts` on `gateSandboxCount()` assertions (e.g. `:511` expected `before`, received `before+1`; an OFF-path that should create no fresh worktree appeared to see one).

This was a **flake, not a real failure**:

- The PR under test is **docs-only** (markdown ADRs + `docs/ci/README.md`); it cannot change runtime worktree/sandbox behaviour.
- `vitest run test/fresh-worktree-gate.test.ts` in ISOLATION passes **16/16**.
- Re-running the FULL suite immediately after passed **2585/2585**.

## Likely mechanism (hypothesis)

`gateSandboxCount()` appears to count fresh-worktree gate sandboxes by some shared/global signal (a temp-dir scan or a process-wide counter). Under the full parallel suite, a CONCURRENT test that legitimately creates a gate sandbox can be in-flight while this test snapshots `before`/`after`, so the OFF-path test occasionally observes a sibling test's sandbox and reads +1. I.e. the count is not isolated per-test.

## Suggested fix direction (not done here)

Make the sandbox-count assertion robust to concurrency: scope the count to THIS test's own sandbox root/prefix (a per-test temp dir or a unique tag), or assert a delta keyed to this test's own gate invocation rather than a global count snapshot. Do NOT serialise the whole file just to dodge it.

Captured during the rename-tasks drive; filed so the flake is not mistaken for a regression. Conductor proceeded to merge PR #208 on the green re-run (docs-only, criteria met).
