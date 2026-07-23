---
title: 'review-gate non-blocking nits for ''rename-gc-ledger-stuck-lock-report-to-orphan-lock'' (Gate 2 approve)'
date: 2026-07-14
status: open
reviewOf: rename-gc-ledger-stuck-lock-report-to-orphan-lock
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'rename-gc-ledger-stuck-lock-report-to-orphan-lock' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Test file name still contains 'stuck-report' (packages/dorfl/test/release-lock-and-gc-stuck-report.test.ts) while its describe was renamed to 'orphan-lock report'. Consider a follow-up rename for full coherence; not blocking since task explicitly scoped to prose/label rename and file rename would churn history for no runtime effect.
  (describe changed to 'gc --ledger orphan-lock report ...' but filename retains stuck-report)
