<!-- dorfl-sidecar: item=task:apply-resolve-reset-flag-discards-work-branch type=task slug=apply-resolve-reset-flag-discards-work-branch allAnswered=false -->

## Q1

**'task:apply-resolve-reset-flag-discards-work-branch' was bounced — how should we proceed?**

> PR/code review (Gate 2) blocked this work:
> - resolveReset is exposed on applyAnsweredQuestions and on DecisionVerdict, and is unit-tested by calling applyAnsweredQuestions directly — but NO real dispatch site in advance.ts actually threads it through. The TASK/SPEC fall-through at advance.ts ~line 1051 calls apply({cwd,item,itemPath,appendQuestions,note}) with neither resolveReset nor arbiter; the observation resolve branch at ~line 1498 does the same (apply({cwd,item,itemPath,note})). advance.ts was not touched in this commit. Net: a bounced TASK's answered resolve+resolveReset:true never reaches the branch-delete end-to-end — exactly the dead-mechanism class the re-scope was written to prevent (attempt-1 put it in the observation-only decider; attempt-2 put it inside the persist but no caller flips it). This is why the re-scope added the PR-2b dependency (so an end-to-end test could route a real task through), and no such end-to-end wiring or test was added. (src/apply-persist.ts adds options.resolveReset + options.arbiter; src/advance.ts unchanged (git show --stat lists no advance.ts). grep of resolveReset in src/ hits only apply-persist.ts / decision-engine.ts / needs-attention.ts — no caller.)
> PR/code review (Gate 2) did not reach a unanimous approve across reviewMaxRounds=2 round(s) (a block is terminal and is never re-rolled); forcing needs-attention (never silently merged or looped).

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):

Resolve, and RESET (discard the work branch, rebuild fresh). The reviewer's block is correct: the saved WIP on `work/task-apply-resolve-reset-flag-discards-work-branch` is wrong-scoped and worthless — it built the `resolveReset` mechanism (the `DecisionVerdict` parser field, the `apply-persist.ts` option, the reused `deleteRemoteWorkBranchIfPresent` primitive) but NEVER wired a real dispatch site, so the flag is a dead no-op end-to-end. There is nothing to continue from; delete the branch and start clean.

Corrective guidance for the rebuild (carry into the next attempt; the re-scope in the task body still holds):

1. The mechanism from the discarded WIP was correct in isolation — the `resolveReset?: boolean` field on `DecisionVerdict` + its parser (`decision-engine.ts`, alongside `resolveReason`), and the shared `deleteRemoteWorkBranchIfPresent` primitive extracted in `needs-attention.ts`. Rebuild that same shape.
2. The MISSING piece (the whole reason for the block): thread `verdict.resolveReset` AND the `arbiter` through the REAL dispatch site. The `resolve` branch in `advance.ts` (~line 1498) calls `apply({cwd, item, itemPath, note})` with neither — it must pass `resolveReset` and `arbiter` into the persist so a bounced TASK's answered `resolve` + `resolveReset:true` actually reaches the branch-delete. Do NOT widen the observation-only `runAgenticDecision` gate; wire it on the TASK apply-persist path per the re-scope.
3. Add the END-TO-END test the re-scope asked for: drive a REAL bounced task through the rung dispatcher (now possible after PR-2b `bounce-migrate-stuck-assertions-and-flip-exit-codes`), not just a direct `applyAnsweredQuestions` unit call, and assert the remote `work/<slug>` branch is deleted then `needsAnswers` is cleared.
4. Record the delete-first-then-clear ordering decision (a partial failure leaves `needsAnswers:true` + sidecar present + branch already-gone; the next tick self-heals via the already-gone no-op) in a `## Decisions` block linked from the done record, NOT only in code JSDoc.
5. Acknowledge the new refusal shape: a branch-delete push FAILURE aborting the whole resolve via `ApplyPersistError` is a new user-visible refusal on the resolve path — either spell it out as intended in the acceptance notes or soften it to a safe-ignore consistent with the already-gone contract.
