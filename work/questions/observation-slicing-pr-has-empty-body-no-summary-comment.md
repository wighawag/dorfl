<!-- dorfl-sidecar: item=observation:slicing-pr-has-empty-body-no-summary-comment type=observation slug=slicing-pr-has-empty-body-no-summary-comment allAnswered=false -->

## Q1

**The triage of this observation is RESOLVED to promote-slice (q1, answered 2026-06-22): mint a task that threads a composed summary as the `body` on the slicing path's `performIntegration` call in `slicing.ts`, mirroring the build path (do.ts:1095, :2205). But no such task exists yet in tasks/backlog, tasks/ready, or tasks/done. Should that task be minted now, and once it is, should this observation be deleted (the source + any sidecar removed in one revertible commit) so it does not re-fire?**

> work/notes/observations/slicing-pr-has-empty-body-no-summary-comment.md still carries `status: open` and `needsAnswers: true` in its frontmatter, yet its body already records both applied answers. q1: "promote-slice ... Fix is well-localised: add a composed summary as `body` in the slicing.ts performIntegration call. Disposition: promote-slice." q2: the slice-set acceptance gate's `review` prose IS already posted (it rides the shared performIntegration review-comment poster), so the PR-body gap is independent and the fix stays narrow (body threading only). A grep of work/tasks/{backlog,ready,done} found no task implementing the empty-body/body-threading fix. This repo also has a known hazard that observation-triage re-fires when a task already exists or the source lingers open (see work/notes/observations/observation-triage-re-fires-when-task-for-observation-already-exists-2026-06-22.md), so the stale `needsAnswers: true` + lingering open status is itself a loose end.

_Suggested default: Mint the task (scope: thread a composed slice-set summary as `body` into the slicing.ts performIntegration call only; the review-prose comment path is out of scope per q2), then delete this observation in one revertible commit. Note the vocabulary cutover: the answers say "slice" but this repo has hard-cut slice -> task, so the produced item is a `task:`, not a `slice:`._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
