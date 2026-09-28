---
title: 'The strictMergeApproval re-stale check runs after the continue rebase, so it can almost never fire'
slug: strict-merge-approval-restale-check-runs-after-the-continue-rebase
date: 2026-09-28
status: spotted
---

2026-09-28, noticed while building `ci-split-answered-merge-action`.

In `apply-merge-action.ts`, both `performMergeAction` (laptop) and `prepareMergeLand` (CI agent half) call `mergeBaseMoved(job)` AFTER `createJob`, and `createJob` has already rebased the kept `work/task-<slug>` onto the freshly fetched `main` (its continue path). `mergeBaseMoved` compares `merge-base(HEAD, <origin>/main)` with `<origin>/main`, which are then equal unless `main` moved in the few milliseconds between the two fetches. So with `strictMergeApproval: true` the answered merge still lands on a green re-verify instead of re-surfacing when the base moved since the answer. Unverified beyond reading the code; the CI split kept today's order (the `merge-restale` three-process test hands the intent over directly because the agent half cannot produce it deterministically). A fix would compare against the kept tip's merge-base captured before the rebase.
