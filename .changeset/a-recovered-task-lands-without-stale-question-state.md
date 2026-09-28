---
'dorfl': patch
---

A task that was surfaced to needs-attention and then recovered no longer lands in `work/tasks/done/` still carrying `needsAnswers: true` and its `work/questions/task-<slug>.md` sidecar. The land now clears both in the done-move commit itself (the flag is set to `needsAnswers: false`, the unanswered sidecar is deleted), on every land path: merge and propose, the stranded-branch recovery, and the CI apply phase. State the rebase brings in (a kept branch cut before the surface) is folded into the same commit. A sidecar carrying a human's answer is left untouched, as the claim-time reconcile already does, and a task that lands normally is unchanged.
