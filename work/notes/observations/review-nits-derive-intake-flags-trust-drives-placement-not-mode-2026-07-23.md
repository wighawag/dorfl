---
title: review-gate non-blocking nits for 'derive-intake-flags-trust-drives-placement-not-mode' (Gate 2 approve)
date: 2026-07-23
status: open
reviewOf: derive-intake-flags-trust-drives-placement-not-mode
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'derive-intake-flags-trust-drives-placement-not-mode' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify Decision 1: IntakeIntegrationFlags keeps its {spec, task, originTrust} shape and REPURPOSES task/spec to gate-derived (autoBuild/autoTask) rather than removing the fields. The acceptance criterion allowed 'no trust-driven fields OR repurposed'; the agent chose repurposed because the workflow still needs both file-emit modes on the wire and the validator asserts both branches. Reasonable and minimal; ratify.
  (work/notes/observations/2026-07-23-derive-intake-flags-interface-reshape-decisions.md Decision 1; task acceptance criterion 2)
- Ratify Decision 2: the workflow passes ONLY --origin-trust, NOT trust-derived --*-land-in flags. The prompt phrase 'the WORKFLOW passes the --*-land-in flags based on trust' was looser than the code: intake dispatch already selects untrusted*LandIn by READING the stamp internally (verified at intake.ts ~L306-315, L920/L960). So --origin-trust is what selects untrusted placement; no new flag/concept introduced. Correct against the ADR caller-reads-stamp model; ratify.
  (work/notes/...decisions.md Decision 2; packages/dorfl/src/intake.ts L306-315,L919-960)
