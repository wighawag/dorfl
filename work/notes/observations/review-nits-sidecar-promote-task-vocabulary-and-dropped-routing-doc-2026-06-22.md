---
title: review-gate non-blocking nits for 'sidecar-promote-task-vocabulary-and-dropped-routing-doc' (Gate 2 approve)
date: 2026-06-22
status: open
reviewOf: sidecar-promote-task-vocabulary-and-dropped-routing-doc
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'sidecar-promote-task-vocabulary-and-dropped-routing-doc' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the hard-cutover parse policy (no `promote-slice` alias) AND note that the AC's required `## Decisions` block was not added to the done record / commit body. The decision itself looks RIGHT — it aligns with the sibling `slice-task-prd-brief-vocabulary-hard-cutover` precedent the slice points at, and is covered by a dedicated test asserting `promote-slice` now parses to `undefined`. The recording, however, lives only in the test name string (`it('hard-cutover: the legacy promote-slice disposition is no longer recognised…')`), not in a `## Decisions` block in `work/tasks/done/sidecar-promote-task-vocabulary-and-dropped-routing-doc.md` or in the merge commit body (`git log -1 cce34fb` shows an empty body). The slice AC explicitly required: 'The parse-side back-compat decision … is made and RECORDED in a `## Decisions` block in the done record / PR (or an ADR in `docs/adr/` if it meets the ADR gate)'. Non-blocking because the decision is right, the rationale is captured (in the test name), and it is already merged; flagged so a human can ratify and, if desired, append the Decisions block to the done record.
  (Slice AC line 75 + Prompt line 171; commit cce34fb body is empty; done-record file has no `## Decisions` heading (grep finds only the slice's own self-reference).)
