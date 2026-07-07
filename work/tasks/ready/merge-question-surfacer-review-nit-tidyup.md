Bundled follow-up from the Gate-2 review of `merge-question-surfacer` (non-blocking nits, ratified by the human). All three changes live in `packages/dorfl/src/merge-question-surfacer.ts` and are doc-comment / small-code touch-ups — no behaviour change.

## 1. Fix the misleading TASK_FOLDERS comment

The constant currently reads:

```ts
// Matches advance.ts's findItemPath task-folder set
const TASK_FOLDERS = ['tasks-ready','tasks-backlog','done','cancelled'];
```

The claim is false: advance.ts's `FOLDERS_FOR_TYPE.task` is `['tasks-backlog','tasks-ready','in-progress','done']`. The surfacer's set intentionally ADDS `cancelled` and OMITS `in-progress` (and `needs-attention`).

**Keep the set as-is** (ratified) and rewrite the comment to describe the ACTUAL set + rationale, roughly:

> Task folders scanned by `findTaskItemPath`. Deliberately DIVERGES from advance.ts's `FOLDERS_FOR_TYPE.task`:
> - OMITS `in-progress` (and `needs-attention`): an unmerged `work/<slug>` branch whose body is mid-build should not trigger a merge-question — the build is still active. Such tasks are skipped with reason `no-item-body`.
> - ADDS `cancelled`: a cancelled task with a lingering unmerged work branch SHOULD surface a merge-question so the operator decides whether to merge or drop the branch.

Exact wording is author's choice; the point is the comment must match reality and explain WHY it diverges.

## 2. Document the gh-PR ceiling defaults

`listOpenPullRequestsViaGh` invokes `gh` with `['pr','list','--state','open','--base',base,'--limit','200', …]`. Ratified as-is. Add a short doc-comment on the function stating (one line is fine):

> Best-effort enrichment. The git-reachability floor is authoritative; a PR targeting a non-`main` base (e.g. a stacked PR) or the case of >200 open PRs degrades to floor-only output, never corrupts it. `--state open`, `--base <base>`, and `--limit 200` are deliberate ceilings.

## 3. Mark `MergeQuestionSkipped.reason` PROVISIONAL

The union `'no-item-body' | 'already-pending-merge-question' | 'persist-nothing'` is currently exposed as if stable. No sibling surfacer exists yet, so do NOT lift it to a shared type. Instead, add a doc-comment on the `MergeQuestionSkipped` type (and/or the `reason` field) marking the vocabulary PROVISIONAL, e.g.:

> PROVISIONAL vocabulary. When a second surfacer lands (e.g. a stuck-lock surfacer), promote this to a shared skip-reason type via a dedicated decision; until then it is scoped to merge-question-surfacer and may change.

Do not extract or rename anything now.

## Acceptance

- Comment on `TASK_FOLDERS` accurately describes the set and its divergence from advance.ts, with rationale for both the omission of `in-progress` and the addition of `cancelled`.
- `listOpenPullRequestsViaGh` carries a doc-comment noting the ceiling defaults are best-effort and that the git-reachability floor is authoritative.
- `MergeQuestionSkipped` (or its `reason` field) is doc-commented as PROVISIONAL with a pointer to when it should be promoted.
- No behavioural change; existing tests still pass.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Follow-up

Once this task is done, the source observation `observation:review-nits-merge-question-surfacer-2026-06-26` should be deleted — it exists only to carry these three nits, and they are now captured here.

## Prompt

> Build the task 'merge-question-surfacer-review-nit-tidyup', described above.
