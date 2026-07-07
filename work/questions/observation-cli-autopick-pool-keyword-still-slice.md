<!-- dorfl-sidecar: item=observation:cli-autopick-pool-keyword-still-slice type=observation slug=cli-autopick-pool-keyword-still-slice allAnswered=false -->

## Q1

**This observation flagged the `do`/`advance` auto-pick POOL keyword in cli.ts still being spelled `slice` (doc-vs-code drift). It now appears fully resolved: the dedicated task `rename-selection-pool-slice-keyword-to-task` (which cites this observation by name) is in tasks/done/, and cli.ts reads `build/task/surface/triage` + `build,task,surface,triage`. What should become of this signal: discharge it (delete the observation + its sidecar as resolved-by-done-task), or do you want a follow-up task/check for something still open here?**

> Observation body cites cli.ts ~L1857/~L2387 spelling the pool `build,slice,surface,triage`. Verified against current bytes: cli.ts L1870 help reads 'build/task/surface/triage ... e.g. build,task,surface,triage' and L2445 reads 'build/task/surface/triage'. The only remaining `slice` strings in cli.ts are immutable historical slugs/concept-comments (L635 task slug, L2337 'slice-acceptance-gate' comment) and a JS `result.commit?.slice(...)` call (L3462) — none is the flagged pool keyword. The resolving task work/tasks/done/rename-selection-pool-slice-keyword-to-task.md explicitly names this observation ('flagged by observation cli-autopick-pool-keyword-still-slice.md') and its acceptance required no live `'slice'` pool keyword to remain. The observation file still carries `needsAnswers: true` and sits un-triaged in notes/observations/, so the triage judgement is open even though the underlying drift is closed.

_Suggested default: Discharge it: the flagged drift is resolved by the done task rename-selection-pool-slice-keyword-to-task, so delete this observation and its sidecar in one revertible commit (no follow-up task needed)._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Discharge it. The flagged drift is resolved by the done task `rename-selection-pool-slice-keyword-to-task` (which cites this observation by name), and the only remaining `slice` strings in cli.ts are immutable historical slugs, concept comments, and a JS `.slice(...)` call. Delete the observation and its sidecar in one revertible commit. No follow-up task.
