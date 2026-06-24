<!-- agent-runner-sidecar: item=observation:advance-task-folder-set-omits-tasks-backlog-staged-surface-items-misroute-to-build-2026-06-24 type=observation slug=advance-task-folder-set-omits-tasks-backlog-staged-surface-items-misroute-to-build-2026-06-24 allAnswered=false -->

## Q1

**What becomes of this observation — promote to a task that aligns `FOLDERS_FOR_TYPE` (advance.ts:377) with the staging-inclusive `APPLY_LIFECYCLE_FOLDERS` (apply-persist.ts:36) / surface gather, with a regression test, or some other disposition?**

> The observation is verified by code reading and matches three concrete CI propose-matrix failures (`task:apply-rung-merge-disposition`, `task:cross-job-ref-based-land-lock`, `task:merge-questions-gate-axis`), all alive in `work/tasks/backlog/` with `needsAnswers: true` and no sidecar. Root cause is a deterministic disagreement: `lifecycle-gather.ts` widens the surface candidate pool to `tasks/backlog/` + `prds/proposed/` when `surfaceStaging` is on (default true, prd `staging-surface-and-apply-promote-safety` F2), but `FOLDERS_FOR_TYPE` in `advance.ts` omits those folders, so `readNeedsAnswers()` returns `undefined` and the classifier falls through to build-task → claim → `claim-cas.ts` exit 2 with the misleading 'not found on origin/main' message. `apply-persist.ts:36` already encodes the staging-inclusive set, so this reads as drift between siblings rather than an open design question. With `surfaceStaging` default-on, every staged `needsAnswers` task/prd hits this every tick — recurring, not a race. Suggested fix direction is in the observation body; the gate noted there is that build/claim eligibility must stay POOL-only (staging items remain non-claimable; only the surface/apply polarity widens).

_Suggested default: promote-task: fold `FOLDERS_FOR_TYPE` and `APPLY_LIFECYCLE_FOLDERS` onto one shared staging-inclusive constant so the rung-classifier sees `tasks-backlog`/`prds-proposed`, add a regression test seeding a staged `needsAnswers` task and asserting the tick classifies `surface` (mints the sidecar) without attempting a claim, and explicitly assert build/claim eligibility stays POOL-only._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):
