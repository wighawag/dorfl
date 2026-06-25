<!-- dorfl-sidecar: item=observation:review-nits-sidecar-promote-task-vocabulary-and-dropped-routing-doc-2026-06-22 type=observation slug=review-nits-sidecar-promote-task-vocabulary-and-dropped-routing-doc-2026-06-22 allAnswered=false -->

## Q1

**What should happen to this review-nit signal: drop it as overtaken by events, or still append a short retrospective `## Decisions` block to the done record for the historical trail?**

> This observation (2026-06-22) is a non-blocking Gate-2 nit on the now-merged task `sidecar-promote-task-vocabulary-and-dropped-routing-doc`. It raises ONE concern with two parts: (a) ratify the hard-cutover parse policy that rejected the legacy `promote-slice` disposition (no alias), and (b) note that the AC-required `## Decisions` block was never added to the done record / commit body (the rationale lives only in a test-name string).
>
> Verified against current reality, both parts are largely overtaken by drift:
> - The done record `work/tasks/done/sidecar-promote-task-vocabulary-and-dropped-routing-doc.md` STILL has no `## Decisions` heading (grep finds only its own AC/Prompt references to the phrase at lines 75 and 171) — so part (b) is factually unaddressed.
> - BUT the entire `disposition=` vocabulary the nit is about has since been RETIRED by the later, merged work `agentic-apply-retire-disposition-vocabulary` (PRD `agentic-question-resolution-retire-disposition-vocabulary`). A sidecar entry is now BINARY (no-answer | answered); `packages/dorfl/src/sidecar.ts:33-35` documents `disposition=` as RETIRED and parsed away, and the test that the nit quoted (`hard-cutover: the legacy promote-slice disposition is no longer recognised`) has been replaced by `packages/dorfl/test/sidecar.test.ts:175` ('any disposition token (e.g. the legacy promote-slice) is parsed away — the vocabulary is fully retired'). `surface-protocol-doc.test.ts:75` now even asserts `promote-task` no longer appears in the protocol prose.
>
> So the 'ratify the parse policy' half (a) is moot: there is no longer a promote-slice/promote-task disposition whose parse policy needs ratifying. The only residual is the historical-record half (b): the merged task left an AC-required `## Decisions` block unwritten.

_Suggested default: delete (close as overtaken-by-events) — the disposition vocabulary the nit concerns was fully retired by `agentic-apply-retire-disposition-vocabulary`, making the parse-policy ratification moot; the missing `## Decisions` block is a closed historical artifact on an already-merged task and is not worth re-opening. If the trail matters, the lighter alternative is keep (no action) over minting a task to back-fill a Decisions block into a done record about a now-deleted concept._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
