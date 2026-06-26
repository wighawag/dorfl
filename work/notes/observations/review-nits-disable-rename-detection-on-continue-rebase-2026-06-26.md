---
title: review-gate non-blocking nits for 'disable-rename-detection-on-continue-rebase' (Gate 2 approve)
date: 2026-06-26
status: open
reviewOf: disable-rename-detection-on-continue-rebase
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'disable-rename-detection-on-continue-rebase' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Should an ADR capture the rename-off-over-sentinel decision the task flagged as a strong ADR candidate?
  (Task prompt: 'The rename-off-over-sentinel decision (maintainer, 2026-06-20) is a strong ADR candidate.' No file was added under docs/adr/. The rationale is recorded in the (now done/) task body and in source comments, which arguably satisfies the acceptance criterion, but a durable ADR would survive task-archival better.)
- Regression coverage is only at the rebaseContinuedBranchOntoMain seam; the two integration-core rebase sites (performIntegration step-4 and recoverAlreadyCommitted's retry loop) are not directly exercised for the directory-rename failure shape.
  (packages/dorfl/test/continue-branch.test.ts adds 3 tests, all against rebaseContinuedBranchOntoMain. integration-core.ts:1108 and :1700-ish rebase invocations were also modified but rely on visual inspection + the shared knob being correct. A future regression at those sites would not be caught by the new tests.)
- Commit message body is empty — no 'Decisions' block was recorded, even though the task explicitly asked the agent to RECORD non-obvious in-scope decisions (which exact rebase invocations got the flag, whether an ADR was deferred, etc.).
  (git log -1 HEAD shows only the title line. AGENTS / task prompt: 'RECORD non-obvious in-scope decisions you make while building (e.g. which exact rebase invocations you touch…)'. The decisions are inferable from the diff + source comments, but a Decisions block was the convention.)
