<!-- dorfl-sidecar: item=observation:fresh-worktree-gate-test-gatesandboxcount-flaky-under-parallel-load type=observation slug=fresh-worktree-gate-test-gatesandboxcount-flaky-under-parallel-load allAnswered=false -->

## Q1

**What becomes of this signal — promote to a task that fixes the global temp-dir scan in gateSandboxCount() (e.g. scope to a per-test sandbox root/prefix or assert a delta keyed to this test's own invocation), keep as an open observation, or drop?**

> Observation `work/notes/observations/fresh-worktree-gate-test-gatesandboxcount-flaky-under-parallel-load.md` reports 2/2585 flakes in `packages/dorfl/test/fresh-worktree-gate.test.ts` under full `pnpm -r test`, never in isolation. Root cause hypothesis is concrete and confirmable from the source: `gateSandboxCount()` at line 68 does `readdirSync(tmpdir()).filter((d) => d.startsWith('dorfl-fresh-gate-'))` — a PROCESS-WIDE scan of the shared OS temp dir, with no per-test prefix. It is asserted as a `before`/`after` equality at lines 250, 274, 337, 511, 533, so any sibling test (in this file or another, since vitest runs files in parallel) that creates a sandbox between snapshots flips an OFF-path assertion to `before+1` — exactly the symptom seen at :511. The observation already names a fix direction (per-test prefix / delta keyed to own invocation; NOT serialising the file). This is a real correctness gap in the test's isolation — a recurring flake here will erode trust in the acceptance gate (`pnpm -r build && pnpm -r test && pnpm format:check`).

_Suggested default: promote-task — small, well-scoped test-hardening change with a clearly identified root cause (shared `tmpdir()` scan with a shared prefix) and a fix direction the observation already sketches; keeping it as an observation just lets the flake recur and get re-investigated._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):
