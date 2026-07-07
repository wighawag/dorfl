<!-- dorfl-sidecar: item=observation:review-nits-merge-question-surfacer-2026-06-26 type=observation slug=review-nits-merge-question-surfacer-2026-06-26 allAnswered=false -->

## Q1

**What becomes of nit 1 — the TASK_FOLDERS set in merge-question-surfacer (['tasks-ready','tasks-backlog','done','cancelled']) diverging from advance.ts's FOLDERS_FOR_TYPE.task (['tasks-backlog','tasks-ready','in-progress','done']) while the inline comment still claims it matches?**

> packages/dorfl/src/merge-question-surfacer.ts:168-175 declares TASK_FOLDERS with 'cancelled' ADDED and 'in-progress' OMITTED, but the doc-comment says 'Matches advance.ts's findItemPath task-folder set'. advance.ts:485-489 confirms the divergence. Consequence: an unmerged work/<slug> whose body sits in in-progress is skipped with the misleading reason 'no-item-body'; a cancelled task with a lingering branch DOES get a merge-question. Both are plausibly intended, but undeclared.

_Suggested default: Keep the folder set as-is (both behaviours are the intended ones); fix the misleading comment to describe the actual set and the rationale (skip active builds, question lingering branches on cancelled). Close the observation with a tiny code-comment fix task._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Keep the folder set as-is (skip active in-progress builds; question lingering branches on cancelled tasks, both intended) and fix the misleading doc-comment to describe the ACTUAL set + rationale. Small code-comment task (bundle Q1-Q3 into one tidy-up).

## Q2

**What becomes of nit 2 — the ceiling defaults baked into listOpenPullRequestsViaGh (--state open, --base <base>, --limit 200) that make PRs targeting a non-main base invisible and silently truncate at >200 open PRs?**

> packages/dorfl/src/merge-question-surfacer.ts:444-460. The floor (git reachability) is authoritative and the ceiling is enrichment-only, so both blindspots degrade to floor-only behaviour rather than corrupting output. Still, 'stacked PR invisible to enrichment' and '>200 silent truncation' are undeclared in-scope decisions.

_Suggested default: Ratify the defaults (floor is authoritative; ceiling is best-effort) and record the rationale as a one-line note in the function's doc-comment. No task; close observation._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Ratify the ceiling defaults (git-reachability floor is authoritative; the gh-PR enrichment is best-effort, so a non-main-base or >200-PR blindspot degrades to floor-only, never corrupts output). Record the rationale as a one-line doc-comment note on the function. Fold into the Q1 tidy-up task.

## Q3

**What becomes of nit 3 — pinning (or marking provisional) the MergeQuestionSkipped.reason enum ('no-item-body' | 'already-pending-merge-question' | 'persist-nothing') as the surfacer's stable vocabulary before a sibling stuck-lock surfacer forks it?**

> packages/dorfl/src/merge-question-surfacer.ts:143-146. The reviewer flags this as a pre-emptive contract decision: a future stuck-lock surfacer will likely want to share the vocabulary; pinning now avoids a fork later.

_Suggested default: Mark the enum PROVISIONAL in its doc-comment (do not lift to a shared type yet — no sibling surfacer exists); promote to a real decision when the second surfacer lands. Close observation._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Mark the MergeQuestionSkipped.reason enum PROVISIONAL in its doc-comment (do not lift to a shared type yet, no sibling surfacer exists). Promote to a real shared-vocabulary decision when the second (stuck-lock) surfacer lands. Fold into the Q1 tidy-up task, then delete this observation.
