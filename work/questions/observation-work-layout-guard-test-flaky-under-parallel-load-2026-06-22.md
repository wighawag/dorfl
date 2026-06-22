<!-- agent-runner-sidecar: item=observation:work-layout-guard-test-flaky-under-parallel-load-2026-06-22 type=observation slug=work-layout-guard-test-flaky-under-parallel-load-2026-06-22 allAnswered=false -->

## Q1

**What becomes of this signal — promote to a task that hardens the guard against parallel-load misreads, keep as an open observation pending more sightings, fold into the sibling observation `fresh-worktree-gate-test-gatesandboxcount-flaky-under-parallel-load` (same suspected class of flake), or drop?**

> Observation `work/notes/observations/work-layout-guard-test-flaky-under-parallel-load-2026-06-22.md` records ONE transient failure in `test/work-layout-guard.test.ts` during a full `pnpm -r test` run inside the `rename-config-keys-slicing-to-tasking` task; the same test passed 2585/2585 on re-run and 3x in isolation. The author judges it a test-isolation flake (the guard scans `src/` at runtime under heavy parallel load), explicitly not a real `work/<folder>` literal violation, and explicitly likens it to the already-filed sibling observation `fresh-worktree-gate-test-gatesandboxcount-flaky-under-parallel-load.md` (which proposes scoping counts per-test rather than serialising). No hardening task currently exists for the work-layout guard specifically; `work/tasks/{todo,backlog}` contain no matching item (closest is the unrelated `ci-template-parallel-merge-fanout`). Single sighting so far, no reproducer, no proven root cause.

_Suggested default: keep — single sighting, no reproducer, and a closely-related sibling observation already exists; let a second sighting (or whoever picks up the sibling) confirm the shared mechanism before spending a task slot. If a hardening task IS opened, prefer one task that addresses the shared `src/`-tree / sandbox-scan-under-parallel-load class for both guards rather than two parallel ones._

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):
