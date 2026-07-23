---
title: 'Route intake task emit through resolvePlacement + originTrust stamp (parity with spec emit)'
slug: intake-task-placement-symmetry
spec: untrusted-origin-carries-via-stamp-intake-placement-symmetry-and-ci-gate-resolution
blockedBy: [placement-drop-untrusted-rung]
covers: [1, 2, 9]
---

## What to build

Bring the intake TASK emit to parity with the intake SPEC emit: place the emitted task DOCUMENT via the shared placement resolver instead of hardcoding `tasks-ready`, and let the file-emit integration mode be the operator/config value (no longer author-trust-derived).

- In `intake.ts` `dispatchTask`: compute the task `relPath` via `resolvePlacement` + the TASK placement slots (`tasks/backlog` vs `tasks/ready`), fed the trusted-vs-untrusted selection (`untrustedTasksLandIn` when the item is untrusted, else `tasksLandIn`) + the explicit operator flag. Stamp `originTrust` onto the emitted task (the value is already passed into `dispatchTask`).
- Thread `tasksLandIn` / `untrustedTasksLandIn` / the explicit `--tasks-land-in` override into `dispatchTask` (the spec path already threads its equivalents; mirror that plumbing).
- Replace the hardcoded `workItemRel('tasks-ready', ...)` with the resolver-chosen folder.

Net behaviour: an untrusted-author issue now MERGES a task document to `main` (into `backlog` by default, or `ready` if configured), carrying the stamp — instead of opening a document PR. A subsequent build of a `ready`-landed untrusted task still forces a code PR via the live build rule.

## Acceptance criteria

- [ ] `dispatchTask` computes its path via `resolvePlacement` + the task slots; the hardcoded `tasks-ready` path is gone.
- [ ] The emitted task carries `origin: issue` + `originTrust: <value>`.
- [ ] An untrusted-author issue with default config ⇒ the task file MERGES to `work/tasks/backlog/` (no document PR).
- [ ] `untrustedTasksLandIn: ready` ⇒ the untrusted task file lands in `work/tasks/ready/` carrying the stamp.
- [ ] A trusted-author issue is placed per `tasksLandIn` (unchanged normal path).
- [ ] Integration test (offline provider) covers the untrusted→backlog default, the untrusted→ready configured case (stamp present in both), and asserts a subsequent build of the ready-landed untrusted task forces propose.

## Blocked by

- Blocked by `placement-drop-untrusted-rung` (the resolver + caller-selection shape must exist first).

## Prompt

> Goal: make the intake TASK emit behave like the intake SPEC emit — merge the task DOCUMENT to main into a resolver-chosen folder carrying the origin-trust stamp, rather than hardcoding `tasks-ready` and forcing a document PR for untrusted authors.
>
> Domain: `intake.ts` has `dispatchTask` and `dispatchSpec`. `dispatchSpec` already calls `resolvePlacement` with the spec placement slots + `specsLandIn`/`untrustedSpecsLandIn` and stamps `originTrust`. `dispatchTask` does NOT — it hardcodes `const relPath = workItemRel('tasks-ready', ...)` and relies on the file-emit MODE to gate untrusted. Your job: make `dispatchTask` mirror `dispatchSpec` for placement + stamping. The TASK placement slots + `landingToSide` helper already exist in `tasking.ts` (`TASK_PLACEMENT_SLOTS`); reuse, do not duplicate.
>
> Where to look: `intake.ts` `dispatchTask` (~L1110 the hardcoded relPath; ~L840 the switch that dispatches with `integration: modes.task` + `originTrust`); the spec twin `dispatchSpec` right below it as the reference implementation; `tasking.ts` for the task slots + side mapping. The `originTrust` value is already threaded into `dispatchTask` — you are consuming it for placement, and it is already stamped by `renderBacklogTask`; verify the stamp lands.
>
> Test at the intake integration seam (the offline-provider tasking-integration style test): untrusted issue → task merges to backlog (default) / ready (configured), stamp present, and a follow-on build of the ready case proposes. Governing decision: `docs/adr/untrusted-origin-carries-via-stamp-not-forced-staging.md`.
>
> Note: this task changes `dispatchTask`'s placement/stamp only. The author-trust → file-emit-MODE derivation lives in `intake-trigger-template.ts` and is rewritten in the NEXT task; here just make `dispatchTask` honor the placement inputs + integration mode it is given. Done: parity achieved, tests green, gate green.
