<!-- dorfl-sidecar: item=task:strict-merge-approval-restale-check-runs-before-the-continue-rebase type=task slug=strict-merge-approval-restale-check-runs-before-the-continue-rebase allAnswered=false -->

## Q1

**'task:strict-merge-approval-restale-check-runs-before-the-continue-rebase' was bounced — how should we proceed?**

> The task's premise ("compare the kept branch's pre-rebase merge-base with current main before the continue rebase; one implementation for laptop and the CI agent half") is sound for the laptop path but causes a re-stale LIVELOCK in the CI split, and fixing that needs a contract change outside this task.
>
> Evidence: (1) No approved base is recorded anywhere. `SidecarEntry` (sidecar.ts) has no base field and merge-question-surfacer.ts stores none, so the only usable base is the kept branch's pre-rebase merge-base. (2) Laptop (`performMergeAction`): `createJob` without `localContinue` force-with-lease PUSHES the rebased kept tip before `restale` is returned. The follow-up question is therefore asked against the rebased base, and a re-answer lands if main has not moved again. That is coherent. (3) CI (`prepareMergeLand`): `createJob({localContinue: true})` rebases only locally. The `merge-restale` handoff row in ci-handoff-format.ts is `bundle: NO_BUNDLE` with empty products (spec'd by the `ci-agent-job-without-write-token` spec / ADR `ci-agent-job-holds-no-write-token`). `applyAnsweredMerge` in ci-phase-treeless.ts only runs `runRungAndPublish` (append follow-up, re-pause) and never publishes the rebase. On the next answered `merge`, the kept branch still has its original merge-base, so the pre-rebase check fires again, and it keeps firing. With strictMergeApproval on in CI, an item can never land once main has moved since the build. The task's e2e acceptance would still pass because it never re-answers the follow-up.
>
> Suggested re-scope, pick one: (a) the `merge-restale` handoff carries the locally rebased tip as a bundle, and the apply job pushes it leased on `continueTip` before re-pausing (matching the laptop's push). This changes the spec'd handoff row and adds an apply-side write with a stale-lease failure mode. Or (b) record the approved base (main SHA) with the merge answer or follow-up entry, which is a new sidecar field set by the surfacer and the re-surface path, and compare against it in both paths. Either way, also decide whether "base moved since the branch was built" (which re-surfaces almost every first answer once main has moved at all) is the intended strict semantics, versus "moved since the question was surfaced". Finally, the task file is in work/tasks/backlog/, not work/tasks/ready/ as dispatched.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
