---
title: 'Harden fresh-worktree-gate sandbox count against parallel flake'
slug: harden-fresh-worktree-gate-sandbox-count-against-parallel-flake
reason: flake-not-reproducible — the `gateSandboxCount()` OFF-path flake this task targets did NOT surface in ~28 full `pnpm -r test` runs on 2026-07-11/12 (3 explicit back-to-back loop runs PLUS ~25 Gate-1 gate runs during the drive-tasks session that merged the rest of the pool), all green. The task's own VERIFY-BEFORE-BUILD banner said to drop it if the flake did not reproduce. There is no live signal to fix; the only current flaky-fresh-gate observation (`flaky-fresh-gate-and-self-renaming-folder-fixture-2026-07-11`) is a DIFFERENT failure (`m.oldName is not a function` / "No projects found"), not this counting race. Dropped clean per the human's instruction (2026-07-12). If the specific `gateSandboxCount()` +1 race resurfaces, mint a fresh observation with a reproducing run rather than resurrecting this task; the per-test-scoping fix sketched below stays a valid starting point.
---

> **CANCELLED 2026-07-12 (drive-tasks stuck-set resolution).** The targeted flake is not currently reproducible; see `reason:` above.

> **RE-SCOPED / VERIFY-BEFORE-BUILD 2026-07-11 (ready-pool analysis).** The specific `gateSandboxCount()` OFF-path flake this task targets did NOT reproduce in THREE consecutive full `pnpm -r test` runs on main 2026-07-11 (all green, 2968/2968; 16/16 in isolation). The original source observation is gone; the only current flaky-fresh-gate observation (`flaky-fresh-gate-and-self-renaming-folder-fixture-2026-07-11`) is a DIFFERENT failure (`m.oldName is not a function`), not this counting race. So: DEPRIORITISED. Before building, re-run `for i in 1 2 3 4 5; do pnpm -r test || break; done` and confirm the `gateSandboxCount()` +1 race still reproduces. If it does, the per-test-scoping fix below is correct as written. If it does not, close this task (the scoping change is still defensible hardening but is chasing a flake that is not currently observable — route to backlog or drop rather than spend a claim). Do NOT build on the un-reproduced premise.

## Context

`test/fresh-worktree-gate.test.ts` intermittently fails under the full `pnpm -r test` parallel run on `gateSandboxCount()` assertions (e.g. line ~511: OFF-path test expects `before` sandboxes, observes `before+1`). In isolation (`vitest run test/fresh-worktree-gate.test.ts`) it passes 16/16; re-running the full suite immediately after passes 2585/2585. Observed while re-verifying docs-only PR #208 (`rename-docs-prose-slicing-to-tasking`) — the PR cannot possibly affect runtime worktree/sandbox behaviour, confirming this is a test-isolation bug, not a regression.

## Root cause (hypothesis, to confirm while fixing)

`gateSandboxCount()` currently counts fresh-worktree gate sandboxes via a process-wide signal — a scan of the shared tmpdir for `dorfl-fresh-gate-*` (or equivalent global counter). Under the parallel suite, a CONCURRENT sibling test that legitimately creates a gate sandbox can be in-flight when this test snapshots `before`/`after`, so the OFF-path test occasionally sees a sibling's sandbox and reads +1. The count is not isolated per-test.

## What to do

Make the sandbox-count assertion robust to concurrency by SCOPING it to this test's own sandbox root, not the global tmpdir:

- Give each test (or each gate invocation within the test) a UNIQUE prefix/tag — e.g. a per-test tmp root, or a unique `DORFL_FRESH_GATE_TAG`-style identifier baked into the sandbox directory name — so `gateSandboxCount()` can filter to only sandboxes belonging to THIS test.
- Assert a DELTA keyed to this test's own gate invocation (before/after scoped to its own prefix), not a snapshot of a shared global counter.
- Keep the OFF-path assertion meaningful: it must still prove the gate did NOT create a sandbox for this test's invocation, just without being fooled by a sibling test's sandbox.

### Do NOT

- Do NOT serialise the whole file (`describe.sequential`, `test.concurrent(false)` blanket, etc.) just to dodge the race. That hides the isolation bug and slows the suite.
- Do NOT weaken the assertion to a range/tolerance (`toBeGreaterThanOrEqual`) — that would mask real regressions in gate behaviour.

## Acceptance

- `vitest run test/fresh-worktree-gate.test.ts` still passes 16/16 in isolation.
- Full `pnpm -r build && pnpm -r test && pnpm format:check` is green.
- Re-running the full suite several times back-to-back (e.g. `for i in 1 2 3 4 5; do pnpm -r test || break; done`) does not reproduce the `gateSandboxCount()` flake.
- The fix is visibly a SCOPING change (per-test prefix / delta on own invocation), not a serialisation workaround.

## Pointers

- File: `test/fresh-worktree-gate.test.ts` (see around line 511 for the OFF-path assertion that flaked).
- Helper: `gateSandboxCount()` in that file (or wherever it is defined) — this is the function whose counting strategy needs to become per-test-scoped.
- Origin: observation `fresh-worktree-gate-test-gatesandboxcount-flaky-under-parallel-load` (2026-06-22), spotted during Gate-3 re-verify of PR #208. Delete that observation as part of finishing this task.

## Prompt

> Build the task 'harden-fresh-worktree-gate-sandbox-count-against-parallel-flake', described above.
