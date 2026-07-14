<!-- dorfl-sidecar: item=task:apply-resolve-reset-flag-discards-work-branch type=task slug=apply-resolve-reset-flag-discards-work-branch allAnswered=false -->

## Q1

**'task:apply-resolve-reset-flag-discards-work-branch' was bounced — how should we proceed?**

> PR/code review (Gate 2) blocked this work:
> - resolveReset is exposed on applyAnsweredQuestions and on DecisionVerdict, and is unit-tested by calling applyAnsweredQuestions directly — but NO real dispatch site in advance.ts actually threads it through. The TASK/SPEC fall-through at advance.ts ~line 1051 calls apply({cwd,item,itemPath,appendQuestions,note}) with neither resolveReset nor arbiter; the observation resolve branch at ~line 1498 does the same (apply({cwd,item,itemPath,note})). advance.ts was not touched in this commit. Net: a bounced TASK's answered resolve+resolveReset:true never reaches the branch-delete end-to-end — exactly the dead-mechanism class the re-scope was written to prevent (attempt-1 put it in the observation-only decider; attempt-2 put it inside the persist but no caller flips it). This is why the re-scope added the PR-2b dependency (so an end-to-end test could route a real task through), and no such end-to-end wiring or test was added. (src/apply-persist.ts adds options.resolveReset + options.arbiter; src/advance.ts unchanged (git show --stat lists no advance.ts). grep of resolveReset in src/ hits only apply-persist.ts / decision-engine.ts / needs-attention.ts — no caller.)
> PR/code review (Gate 2) did not reach a unanimous approve across reviewMaxRounds=2 round(s) (a block is terminal and is never re-rolled); forcing needs-attention (never silently merged or looped).

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
