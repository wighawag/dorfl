<!-- dorfl-sidecar: item=task:needs-attention-test-cleanup-enotempty-flake type=task slug=needs-attention-test-cleanup-enotempty-flake allAnswered=false -->

## Q1

**Which fix strategy should this task implement: (a) await all in-flight git/fs ops before `rmSync` in `Scratch.cleanup()`, (b) retry `rmSync` on ENOTEMPTY (e.g. small bounded retry loop), or (c) both — defensive retry plus best-effort await?**

> The promoted observation (`work/notes/observations/needs-attention-test-cleanup-enotempty-flake.md`) records the race as real but offers two alternative fixes without choosing. The task body is a stub ('A human answered "promote": draft this into a buildable task') with no scoping decided. `Scratch.cleanup()` in `packages/dorfl/test/helpers/gitRepo.ts` (around line 152) is a synchronous `rmSync(root, {recursive: true, force: true})` — option (a) implies making cleanup async / tracking in-flight ops; option (b) is a localised, sync-preserving change; option (c) is belt-and-braces.

_Suggested default: (b) retry `rmSync` on ENOTEMPTY with a small bounded loop — smallest, most localised change, preserves the sync `cleanup()` signature, directly addresses the observed flake; revisit (a) only if retries do not eliminate it._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**What is the acceptance signal that the flake is fixed — given it only reproduced under full `pnpm -r test` and not in isolation? E.g. N consecutive green `pnpm -r test` runs locally / in CI, a stress loop around the specific test, or just 'verify gate green + no recurrence over some window'?**

> The observation notes the failure was intermittent under `pnpm -r test`; re-running in isolation passed. Per `AGENTS.md` the standard acceptance gate is `pnpm -r build && pnpm -r test && pnpm format:check`, which can pass on a flaky test by luck. Without a stronger acceptance signal a 'green verify' does not actually demonstrate the race is closed.

_Suggested default: Verify gate green is the floor; additionally run the affected test file (and `pnpm -r test`) in a short stress loop (e.g. 20× locally) to gain confidence — but do NOT add a stress loop to CI._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Scope: is this strictly a test-helper fix in `packages/dorfl/test/helpers/gitRepo.ts`, or should the same robustness be applied to any other test cleanup paths that `rmSync` a tree shortly after git/fs writes (e.g. other scratch/temp helpers)?**

> Observation only cites the `gitRepo.ts` `cleanup()`, but the same ENOTEMPTY race pattern can recur anywhere a recursive sync rmdir follows in-flight writes. Deciding scope up-front avoids either an under-scoped fix that leaves sibling flakes, or scope-creep beyond the promoted slice.

_Suggested default: Scope strictly to `Scratch.cleanup()` in `packages/dorfl/test/helpers/gitRepo.ts` (the only cited site); if a grep reveals one or two near-identical helpers, fold them in, otherwise file a follow-up observation rather than expanding._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Stale path reference: the original observation cited `test/helpers/gitRepo.ts:102` but the real `rmSync` is around `packages/dorfl/test/helpers/gitRepo.ts:152`. Should the task body be updated to carry the corrected reference before build, or is leaving the builder to rediscover it acceptable?**

> The observation's applied-answer explicitly flags 'the cited path is stale … whoever writes the slice should update the reference.' The current task body does not carry the corrected pointer, so the only place that note lives is the resolved observation file.

_Suggested default: Update the task body to cite `packages/dorfl/test/helpers/gitRepo.ts` `Scratch.cleanup()` (around line 152) so the build agent does not have to re-derive it from the observation._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):
