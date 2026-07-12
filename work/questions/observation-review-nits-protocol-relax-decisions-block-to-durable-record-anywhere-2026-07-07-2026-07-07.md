<!-- dorfl-sidecar: item=observation:review-nits-protocol-relax-decisions-block-to-durable-record-anywhere-2026-07-07-2026-07-07 type=observation slug=review-nits-protocol-relax-decisions-block-to-durable-record-anywhere-2026-07-07-2026-07-07 allAnswered=false -->

Item: [`observation:review-nits-protocol-relax-decisions-block-to-durable-record-anywhere-2026-07-07-2026-07-07`](../notes/observations/review-nits-protocol-relax-decisions-block-to-durable-record-anywhere-2026-07-07-2026-07-07.md)

## Q1

**Is the source-observation link via the task's ## Why body good enough for the done record, or do you want an explicit ## Decisions / backlink block appended to work/tasks/done/protocol-relax-decisions-block-to-durable-record-anywhere-2026-07-07.md?**

> Acceptance bullet said: 'Done record links to this task and to the source observation ... and durably records any non-obvious wording choices per the NEW rule (dogfood the relaxed convention).' The done file is byte-identical to the ready file; commit a8503393 body is empty; the source observation slug is mentioned in the ## Why prose but there is no dedicated Decisions/backlink block. Under the newly relaxed rule any durable+linked home counts, so 'link-via-Why' arguably already satisfies it — but it does not dogfood the ## Decisions option.

_Suggested default: Accept as-is: the ## Why mention satisfies the relaxed 'record durably and link' rule; close the nit without editing the done record._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Ratify the wording choice of hard-coding 'work/notes/observations/' as the concrete folder path in CLAIM-PROTOCOL.md's list of durable homes, or should it stay generic ('an observation note')?**

> work/protocol/CLAIM-PROTOCOL.md ~L146 reads 'or a dated observation note under work/notes/observations/'. The task spec said 'observation note' generically; picking that concrete path is correct for this repo but bakes a repo-specific folder into a protocol doc that setup propagates to other repos.

_Suggested default: Ratify: keep the concrete path — it matches the WORK-CONTRACT folder layout the protocol already assumes elsewhere, and other set-up repos inherit the same layout._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
