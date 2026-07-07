---
title: review-gate non-blocking nits for 'merge-question-surfacer' (Gate 2 approve)
date: 2026-06-26
status: open
reviewOf: merge-question-surfacer
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'merge-question-surfacer' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the task-folder set used by `findTaskItemPath`: it is `['tasks-ready','tasks-backlog','done','cancelled']` — it ADDS `cancelled` and OMITS `in-progress` (and `needs-attention`) relative to advance.ts's `FOLDERS_FOR_TYPE.task = ['tasks-backlog','tasks-ready','in-progress','done']`, yet the inline comment claims it 'Matches advance.ts's findItemPath task-folder set'. An unmerged work/<slug> branch whose body is currently in `work/in-progress/<slug>.md` will be skipped with reason `no-item-body` (probably desired — active build — but the reason is misleading), and a `cancelled` task with a lingering work branch WILL get a merge-question (probably also desired, but undeclared). Decision not recorded in PR body.
  (packages/dorfl/src/merge-question-surfacer.ts: const TASK_FOLDERS = ['tasks-ready','tasks-backlog','done','cancelled']; comment says 'Matches advance.ts's findItemPath task-folder set' but advance.ts uses ['tasks-backlog','tasks-ready','in-progress','done'].)
- Ratify the CEILING defaults baked into `listOpenPullRequestsViaGh`: `--state open`, `--base <base>` (filters PRs by their target branch), and `--limit 200`. A PR targeting a non-`main` base (e.g. a stacked PR) is invisible to enrichment; >200 open PRs silently truncates. Defensible defaults, but undeclared in-scope decisions.
  (packages/dorfl/src/merge-question-surfacer.ts listOpenPullRequestsViaGh args: ['pr','list','--state','open','--base',base,'--limit','200',…].)
- Ratify the new public `MergeQuestionSkipped.reason` enum (`'no-item-body' | 'already-pending-merge-question' | 'persist-nothing'`) as the surfacer's stable contract — a sibling stuck-lock surfacer will likely want to share this vocabulary; pinning it now (or marking it provisional) avoids a fork later.
  (packages/dorfl/src/merge-question-surfacer.ts MergeQuestionSkipped union.)
