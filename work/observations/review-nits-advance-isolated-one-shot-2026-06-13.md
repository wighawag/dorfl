---
title: review-gate non-blocking nits for 'advance-isolated-one-shot' (Gate 2 approve)
date: 2026-06-13
status: open
slug: advance-isolated-one-shot
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'advance-isolated-one-shot' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the `pushTreelessResult` ff-push: the isolated tick PUSHES tree-less results (surface/apply/triage sidecar + needsAnswers/marker) to the arbiter after a successful rung, whereas the in-place tick leaves that commit in the local participating checkout (performAdvance does not push it). The slice's acceptance criterion framed this as 'behave identically ... same as in-place', but in-place does not auto-push to the arbiter. Is parity-of-effect (work durably reaches each path's source of truth) the intended reading, ratifying the push as correct?
  (advance-isolated.ts adds `pushTreelessResult` (bounded re-fetch+rebase retry, never --force) gated on `TREELESS_RUNGS = {surface, apply, triage-observation}`. It is needed because the isolated clone is reaped, so without the push the tree-less work would vanish; the in-place path relies on the cwd being the durable human checkout. surface-persist.ts confirms `persistSurfacedQuestions` is a LOCAL commit only; the advancing-lock CAS is what reaches the arbiter in-place. The agent recorded this inline (module doc + Decision #2 reference) and via work/observations/advance-treeless-rungs-dont-push-to-arbiter-in-loop-and-registry-paths.md.)
- Ratify Decision #1: this slice adds only `--isolated` (against the cwd-resolved arbiter) and DEFERS `advance --remote <url>` to a sibling concern, even though the `advance` action already types `flags.remote` via `DoFlags`. Confirm `advance --remote` is intentionally out of scope here.
  (cli.ts ~2039 comment states `--isolated` is the only isolation axis and `--remote` plumbing does not exist on `advance`. This matches the slice's recommendation ('--isolated only here; --remote is a separate concern').)
- Ratify Decision #2: the scan/select/refetch skeleton was realized as a thin advance-specific twin (`performAdvanceIsolatedAuto` mirroring `performDoRemoteAuto`) rather than extracting a shared parameterized loop. Accept the duplication, or schedule a follow-up to consolidate the ensure-mirror->scan->select->sequential-loop shape across do-remote-auto.ts and advance-isolated.ts?
  (The slice's Decisions block offered both shapes and noted only the loop skeleton (not the per-item runner) is shareable. The twin is justified because the advance auto-pick threads lifecycle pools (surface/apply/triage) that the `do` skeleton does not, but the loop bodies are near-identical. The per-item runners genuinely differ, so the duplication is bounded.)
- Confirm the captured observation about the loop/registry advance path (advance-loop-driver.ts) having the SAME tree-less-not-pushed gap is acceptable to leave unfixed in this slice.
  (work/observations/advance-treeless-rungs-dont-push-to-arbiter-in-loop-and-registry-paths.md documents that buildRegistrySetAdvanceTick re-clones a fresh per-mirror treelessCwd each tick and (unlike this slice) does not ff-push tree-less results, so a surfaced sidecar may not reach the arbiter's main in the loop/CI path. The slice explicitly scoped this fix to the one-shot path only; the observation routes the loop-path fix for a focused follow-up. Verified accurate against the loop driver source.)
