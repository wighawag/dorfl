## Context

Gate 2 review of `apply-rung-merge-disposition` APPROVED the change but raised four non-blocking nits. The human bundled them into this one follow-up task (see observation `review-nits-apply-rung-merge-disposition-2026-06-28` for the original findings + answers). Nit 3 is a doc-only addendum folded in here; nits 1, 2, 4 are code changes.

## Scope — four bundled changes

### 1. `detectAnsweredMergeAction` should prefer the LATEST answered merge entry (or an unanswered follow-up)

File: `apply-merge-action.ts` (function `detectAnsweredMergeAction`).

Today it loops entries and returns the FIRST answered `kind: merge` entry. The re-stale re-surface path in `advance.ts` (`maybeRunMergeAction` restale branch) APPENDS a new `kind: merge` follow-up question via `appendQuestions` instead of clearing the prior `answer=merge` on the original entry. That append-and-keep-history shape is fine and canonical — the bug is only that the FIRST-match lookup means a subsequent apply run re-fires against the STALE prior answer, not the human's fresh follow-up.

Change `detectAnsweredMergeAction` so that a re-surfaced merge question, not the stale prior answer, drives the next apply run. Concretely: prefer an unanswered follow-up `kind: merge` entry if one exists (that is the re-paused state and apply should NOT fire), else return the LATEST answered `kind: merge` entry (so a fresh follow-up answer wins over a stale one). Add a unit test that walks the exact scenario: original entry answered `merge` → apply runs → restale re-surface appends a new `kind: merge` question → apply must see the append as "pending / no answered merge to act on" (or, once that follow-up is answered, act on the LATEST answer, never the stale one).

### 2. Rename the `refused` merge-action rung outcome away from `usage-error`

File: `advance.ts` (`maybeRunMergeAction`, the `result.outcome==='refused'` branch currently returns `{exitCode:1, outcome:'usage-error'}`).

`usage-error` collides with the vocabulary reserved for genuine caller-usage errors (e.g. the workspacesDir guard in nit 3). `performIntegration` already routes the bounce to needs-attention via its shared seam, so this outcome tag is purely the rung-level signal.

Audit the outcome-tag vocabulary across advance rungs and pick an accurate label for "red re-verify on the rebased tip refused the land": reuse the existing needs-attention / refused tag if one is already established for performIntegration-routed refusals on other rungs, otherwise add a dedicated `merge-refused`. Keep `exitCode: 1`. Update tests that assert the old `usage-error` tag on this path.

### 3. Document the workspacesDir-unset refusal (doc-only, folded in)

The existing guard in `advance.ts` `maybeRunMergeAction` — `workspacesDir === undefined && mergeAction === undefined` ⇒ clean refusal with `usage-error` (this one legitimately IS a caller-usage error, and should keep the `usage-error` tag from #2's audit) — is correct and defensive. Keep it.

Add a one-line note to the advance rung's contract doc describing the workspacesDir-unset refusal, so a future caller that forgets to thread `workspacesDir` gets the documented refusal instead of being surprised. No separate ADR; just the doc line alongside this task.

### 4. Assert the sidecar's source item is a task in `performMergeAction`

File: `apply-merge-action.ts` (`performMergeAction`, currently calls `createJob({slug, type: 'task', ...})` with hard-coded `type: 'task'`).

Today the surfacer only emits merge-questions for tasks, so the hard-coded `type` is correct in practice. But if a future surfacer change ever stamps a `kind: merge` sidecar on a non-task item (e.g. a prd-level unmerged branch), the branch name `work/task-<slug>` will silently mis-target.

Assert at `performMergeAction` entry that the sidecar's source item is a task, and throw a clear error otherwise (message should name the offending item and its actual type, and point at this assertion as the invariant that was violated). Add a unit test that feeds a non-task source item and asserts the loud failure.

## Acceptance

- `detectAnsweredMergeAction` prefers unanswered follow-up `kind: merge`, else returns LATEST answered merge entry; test covers stale-answer + re-surfaced follow-up scenario.
- Refused merge-action returns an accurate outcome tag (not `usage-error`); vocabulary audit recorded in the PR description or a brief note; `exitCode: 1` preserved.
- workspacesDir-unset refusal is documented in the advance rung's contract doc (one line is fine).
- `performMergeAction` asserts source item is a task and fails loudly on non-task input; test covers it.
- `pnpm -r build && pnpm -r test && pnpm format:check` green.
- Delete the source observation `review-nits-apply-rung-merge-disposition-2026-06-28` once this task is minted (per the human's answer on nit 4).
