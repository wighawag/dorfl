---
title: review-gate non-blocking nits for 'placement-drop-untrusted-rung' (Gate 2 approve)
date: 2026-07-22
status: open
reviewOf: placement-drop-untrusted-rung
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'placement-drop-untrusted-rung' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- The PR commit body has no '## Decisions' block; the two in-scope choices (re-expressing the retired 'untrusted-origin' reason as 'configured-default', and updating the intake dispatchSpec caller since the resolver signature changed) are only recorded in code comments and the ADR. Ratify: both look correct and are load-bearing-safe. The reason re-express matches the ADR Consequences text verbatim, and touching dispatchSpec was forced by the ResolvePlacementInput field removal (leaving it would not compile).
  (placement.ts:84 doc; intake.ts:1349 configuredSpecsLanding; ADR Consequences 'retired (or re-expressed as configured-default)')
- Ratify the scope boundary: intake's DIRECT task emit (dispatchTask) does NOT yet consume untrustedTasksLandIn; that is deferred to sibling task intake-task-placement-symmetry (present in work/tasks/ready/). This task correctly owns only the resolver + tasker + intake-spec callers. No hole, but confirm the deferral is intended.
  (config.ts comment names dispatchTask 'a sibling task'; intake-task-placement-symmetry.md exists in ready/)
