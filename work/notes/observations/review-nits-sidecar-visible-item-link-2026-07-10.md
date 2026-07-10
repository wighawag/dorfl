---
title: review-gate non-blocking nits for 'sidecar-visible-item-link' (Gate 2 approve)
date: 2026-07-10
status: open
reviewOf: sidecar-visible-item-link
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'sidecar-visible-item-link' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: task-folder lookup set was narrowed from the WIP's 6 folders to 4 — the transient lock-ref folders 'in-progress' and 'needs-attention' were dropped, so if a task file is scanned while it lives under work/in-progress/ or work/needs-attention/ the link line silently omits instead of resolving. TASK_LIFECYCLE_FOLDERS in work-layout.ts (used by close-job / spec-complete) still includes both; this narrowing looks intentional (durable folders only) but was not recorded in a Decisions block.
  (packages/dorfl/src/sidecar.ts LINK_LIFECYCLE_FOLDERS.task = ['tasks-ready','done','cancelled','tasks-backlog']; work-layout.ts TASK_LIFECYCLE_FOLDERS includes 'in-progress'/'needs-attention'.)
- Ratify: serialiseSidecar's new repoRoot option is OPTIONAL and defaults to no-link. Only the two writing call sites (applyAtomic, persistSurfacedQuestions) were wired to pass cwd; any other current/future caller of serialiseSidecar will silently skip the human-visible link. Deliberate (keeps pure-format tests trivial) but is an unrecorded API-shape decision.
  (packages/dorfl/src/sidecar.ts SerialiseSidecarOptions.repoRoot?: string; call-site wiring only in sidecar-apply.ts and surface-persist.ts.)
