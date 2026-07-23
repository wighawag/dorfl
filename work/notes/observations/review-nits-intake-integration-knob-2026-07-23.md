---
title: review-gate non-blocking nits for 'intake-integration-knob' (Gate 2 approve)
date: 2026-07-23
status: open
reviewOf: intake-integration-knob
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'intake-integration-knob' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: the IntakeIntegrationFlags two-axis {spec,task,originTrust} shape was KEPT (both always equal) rather than collapsed to one mode field, only because intake's CLI consumes --merge-spec/--merge-task on two axes. Reasonable to keep, but is the redundant pair worth a follow-up simplification?
  (Recorded decision 1 in work/notes/observations/intake-integration-knob-flags-reshape-decision-2026-07-23.md; deriveIntakeFlags sets spec=task=intakeIntegration.)
- Ratify: the workflow bash reads .intakeIntegration // .integration in ONE jq expression (shell twin of intakeIntegration ?? integration), and the CLI applies the same fallback at the cli.ts intake seam. Single fallback site, mirrors do.ts tasking threading; confirm this is the intended sole fallback point.
  (cli.ts:4356 config.intakeIntegration ?? config.integration; intake-trigger-template.ts:411 jq .intakeIntegration // .integration.)
