<!-- dorfl-sidecar: item=task:apply-resolve-reset-flag-discards-work-branch type=task slug=apply-resolve-reset-flag-discards-work-branch allAnswered=false -->

## Q1

**'task:apply-resolve-reset-flag-discards-work-branch' was bounced — how should we proceed?**

> The task's "wire it on the TASK apply-persist path" instruction has no defined SOURCE for the `resolveReset` flag on a TASK, and the re-scope explicitly forbids the only obvious source. Specifically:
>
> 1. `applyRung` at `advance.ts:~1051` for `namespace !== 'observation'` calls `applyAnsweredQuestions({cwd, item, itemPath, appendQuestions, note})` UNCONDITIONALLY — it does NOT go through the shared `decide()` engine and never sees a `DecisionVerdict`. The `runAgenticDecision` gate (line ~1044) is `namespace === 'observation'` only.
>
> 2. Applied-answers #1 (2026-07-14, round 1) says: "thread `verdict.resolveReset` AND the `arbiter` through the REAL dispatch site" naming `advance.ts:~1498` — that's the `applyAgenticDecision` resolve branch (INSIDE the observation-only gate). For an observation there is by contract NO `work/<slug>` branch, so wiring there is a permanent no-op end-to-end — exactly the "dead mechanism" the Gate-2 reviewer blocked on the first attempt.
>
> 3. Same applied-answers #1 then says: "wire it on the TASK apply-persist path per the re-scope. Do NOT widen the observation-only `runAgenticDecision` gate". The re-scope ("What to build" §1) repeats: "Do NOT widen the observation-only `runAgenticDecision` gate to tasks/specs — that changes how EVERY task apply-answer dispatches... explicitly out of scope here."
>
> 4. This is contradictory. If `runAgenticDecision` cannot be widened, there is NO decider on the TASK path, hence NO `DecisionVerdict`, hence NO `verdict.resolveReset` to honour. Neither the task body nor the applied answers name an alternative source for the flag on a TASK (options a reviewer might pick: (a) narrow-widen `runAgenticDecision` to `kind: 'stuck'` TASK sidecars only; (b) a deterministic `detectAnsweredStuckAction` sibling of `detectAnsweredMergeAction` that parses the answer text into `keep|reset|cancel`; (c) a new `context.applyResolveReset` driver-injected boolean; (d) an answer-marker HTML comment on the sidecar entry). Each is a user-visible design decision that touches how bounced tasks are drained — not a small factual gap.
>
> 5. Applied-answers #1 also demands "an END-TO-END test... drive a REAL bounced task through the rung dispatcher" — that test is unwritable without picking one of (a)–(d), because otherwise no answer a human types on a bounced-task `kind: stuck` sidecar can reach the `resolveReset:true` code path.
>
> Suggested re-scope: pick the TASK-path source explicitly. Recommended: (b) a `detectAnsweredStuckAction(cwd, item)` sibling of `detectAnsweredMergeAction` (`apply-merge-action.ts`) that parses the LATEST answered `kind: 'stuck'` entry into a `keep | reset | cancel` verb (mirroring `parseMergeAnswer`), and `applyRung`'s TASK persist path (`advance.ts:~1051`) invokes it BEFORE the fall-through `applyAnsweredQuestions` call to pass `resolveReset: verb === 'reset'` + `arbiter`. This is analogous to how `kind: 'merge'` is deterministically dispatched today (no widening of the agentic gate), gives the end-to-end test a real driver, and keeps the `resolveReset?: boolean` verdict channel + shared branch-delete primitive from the discarded WIP reusable. Please confirm this shape (or pick a different source) before rebuild.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
