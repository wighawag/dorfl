<!-- dorfl-sidecar: item=observation:resolvecontinuecontext-doc-still-says-requeue-backlog-claim-gap-2026-06-24 type=observation slug=resolvecontinuecontext-doc-still-says-requeue-backlog-claim-gap-2026-06-24 allAnswered=false -->

## Q1

**What becomes of this signal — promote to a one-line doc-fix task, keep as a noted observation, or drop?**

> Observation notes that `packages/dorfl/src/prompt.ts` (~L335, in `resolveContinueContext`) still says "they survive the requeue → backlog → claim gap", where "backlog" here means the POOL (`tasks/ready/`), not staging — same two-meanings-one-word hazard as the just-fixed `resolveTask`/`do.ts` vocab task (`resolvetask-stale-backlog-vocab-doc-fix`), but deliberately left outside that task's named scope. Fix is a one-line reword: `backlog` → `tasks-ready`/`the pool`. WORK-CONTRACT.md L111, `item-lock.ts:~821`, and `needs-attention.ts:~657` already use the corrected vocabulary ("body still in pool"), so the change is mechanical and consistent with existing norms.

_Suggested default: promote-task — a sibling one-line doc-vocab fix task (e.g. `resolvecontinuecontext-stale-backlog-vocab-doc-fix`) mirroring the just-finished `resolveTask` one; the hazard, fix, and rationale are identical and already vetted._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):

promote-task — a sibling one-line doc-vocab fix task (e.g. `resolvecontinuecontext-stale-backlog-vocab-doc-fix`) mirroring the just-landed `resolvetask-stale-backlog-vocab-doc-fix`: the stale-"backlog"-means-pool hazard, the fix, and the rationale are identical and already vetted. Comments only, no behaviour change.
