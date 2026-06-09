---
title: review-gate non-blocking nits for 'advance-loop' (Gate 2 approve)
date: 2026-06-09
status: open
slug: advance-loop
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'advance-loop' but raised the following non-blocking findings (nits). They do not block integration; this is their durable home for triage — promote-to-slice / keep / delete.

- US #30 (the keep marker / triaged:keep drop-out) is listed in both advance-rung-apply and advance-rung-triage. Both slices verbally coordinate ('the apply rung executes the recorded disposition'; triage 'shared with — and finalised in — the triage rung'), and they are serialized (triage blockedBy apply), so there is no parallel-edit hazard. Confirm at build time that keep-marker writing has a single implementation point (in apply) that triage merely routes into, rather than two parallel implementations. (Mild duplication risk on a shared seam, fully mitigated by the explicit cross-references and the blockedBy serialization; flagged only so the builder keeps one keep-handling code path.)
- advance-verb-resolver's bare-form `advance` (eligible set) is intentionally stubbed-or-single-item until advance-drivers-and-gates lands, with the seam to be recorded in a `## Decisions` block. This is a correct deferral, but it means the verb slice ships a deliberately-incomplete bare form; verify the stub errors clearly ('needs the driver slice') so an intermediate landing is not silently half-functional. (Vertical-slice tracer-bullet seam, explicitly called out in the slice; non-blocking because the drivers slice completes it and the slice documents the seam.)
