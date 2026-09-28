---
'dorfl': patch
---

`dorfl requeue -m "<note>"` now inserts its dated `## Requeue YYYY-MM-DD` handoff section just before the task's `## Acceptance criteria` heading instead of at the end of the body. When the kept work branch had already done-moved the body and appended its `## Decisions` block, the tail-appended note made the next claim's continue rebase conflict and bounce the item to needs-attention, so the requested fix could never be built from the kept branch. The note now rebases cleanly and still reaches the continuing agent's prompt. A body without an `## Acceptance criteria` heading keeps the old end-of-body placement; `requeue` without `-m` is unchanged.
