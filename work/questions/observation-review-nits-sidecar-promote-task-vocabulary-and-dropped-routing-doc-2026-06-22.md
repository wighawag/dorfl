<!-- agent-runner-sidecar: item=observation:review-nits-sidecar-promote-task-vocabulary-and-dropped-routing-doc-2026-06-22 type=observation slug=review-nits-sidecar-promote-task-vocabulary-and-dropped-routing-doc-2026-06-22 allAnswered=false -->

## Q1

**Ratify the hard-cutover parse policy (no `promote-slice` alias) and decide whether to retroactively add the missing `## Decisions` block — promote a small follow-up task to append it to the done record, keep this observation as the durable record of the ratification, or delete as already-decided?**

> Gate 2 APPROVED the slice `sidecar-promote-task-vocabulary-and-dropped-routing-doc` with one non-blocking nit: the slice's AC (line 75) and prompt (line 171) explicitly required the parse-side back-compat decision (drop the `promote-slice` alias — hard cutover, matching the sibling `slice-task-prd-brief-vocabulary-hard-cutover` precedent) to be RECORDED in a `## Decisions` block in the done record or merge commit body. It wasn't: commit cce34fb has an empty body, and `work/tasks/done/sidecar-promote-task-vocabulary-and-dropped-routing-doc.md` has no `## Decisions` heading. The decision itself is right and is covered by a dedicated test (`it('hard-cutover: the legacy promote-slice disposition is no longer recognised…')`), so the rationale survives in the test name — only the AC-required durable recording is missing. Non-blocking because the slice is already merged and the policy is enforced by code+test.

_Suggested default: promote-task — small follow-up to append the `## Decisions` block (ratifying the hard cutover, citing the sibling precedent and the asserting test) to the done record, so the AC is satisfied in retrospect and future archeologists find the rationale where the AC promised it would be._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):
