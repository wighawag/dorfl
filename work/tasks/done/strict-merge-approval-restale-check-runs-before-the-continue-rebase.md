---
title: 'Run the strictMergeApproval re-stale check before the answered merge's continue rebase, so it can actually fire'
slug: strict-merge-approval-restale-check-runs-before-the-continue-rebase
blockedBy: []
needsAnswers: true
---

## What to build

Observation `strict-merge-approval-restale-check-runs-after-the-continue-rebase`: in `apply-merge-action.ts`, both the laptop `performMergeAction` and the CI agent half `prepareMergeLand` call `mergeBaseMoved(job)` AFTER `createJob`, and `createJob` has already rebased the kept `work/task-<slug>` onto the freshly fetched `main`. `mergeBaseMoved` compares `merge-base(HEAD, <origin>/main)` with `<origin>/main`, which are then equal, so with `strictMergeApproval: true` an answered merge still lands after a green re-verify instead of re-surfacing when the base moved since the human answered. Because of this, `ci-split-answered-merge-action`'s three-process `merge-restale` test had to hand its intent over directly.

Decide staleness against what the human approved: take the base the answer was given against (the kept branch's merge-base with `main` before any rebase, or a base recorded with the answer if one exists) and compare it with the current `main` BEFORE the continue rebase runs; then rebase. Keep one implementation for the laptop and the CI agent half.

> FORWARD-NOTE (conductor, 2026-09-28; the human's answer to this task's surfaced stuck question, which this note supersedes): the first build STOPPED because the only usable base, the kept branch's pre-rebase merge-base, livelocks in CI. The `merge-restale` handoff carries no bundle, so the CI rebase is never published, and every re-answer re-fires. The human chose option **(b)** with the **"since the question was asked"** semantics:
>
> - **Record the approved base.** When a merge question is surfaced, and again when the re-stale path re-surfaces it, store the arbiter `main` SHA it was asked against on the sidecar entry. This is a new, bounded, optional field on the entry, set by `merge-question-surfacer.ts` and by the re-surface path.
> - **Compare against it before the continue rebase.** With `strictMergeApproval: true`, both the laptop `performMergeAction` and the CI agent half `prepareMergeLand` compare the current `<arbiter>/main` with that recorded base BEFORE the continue rebase runs. Keep ONE shared implementation. If they differ, it is a re-stale; otherwise rebase and land.
> - **Stale means "`main` moved since the question was asked",** not "since the branch was built". So a first answer given against the current `main` lands.
> - **No livelock.** A re-surfaced question records the NEW base, so a re-answer given while `main` stays put LANDS, in CI as well as on the laptop. Add a test for this: a CI re-stale, then a re-answer, then the item lands.
> - **Legacy entries.** A sidecar entry with no recorded base (written before this change) keeps today's behaviour (no re-stale). Record that in your Decisions.
> - **Staging is expected.** The task body lives in `work/tasks/backlog/`, not `ready/`; this is a deliberate drive-from-staging build.

## Acceptance criteria

- [ ] With `strictMergeApproval: true`, an answered merge whose base moved since the answer re-surfaces the follow-up question (laptop path, tested).
- [ ] The CI agent phase hands over `merge-restale` for the same case from a real agent-phase run, and `ci-phase-answered-merge-e2e.test.ts`'s re-stale case no longer injects its handoff.
- [ ] With `strictMergeApproval` off, or when the base has not moved, the merge lands exactly as today (tested).
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: make the strict merge-approval re-stale check meaningful. Read `apply-merge-action.ts` (`performMergeAction`, `prepareMergeLand`, `mergeBaseMoved`), `workspace.ts` `createJob` (its continue rebase and the `localContinue` option), how the merge answer is recorded in the sidecar, and `ci-phase-answered-merge-e2e.test.ts`. The observation named in the task body has the analysis.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **"Moved" means the tree outside `work/` differs, not a plain sha compare.** The literal "compare the shas" reading can never let a re-answer land: the surfacer's own commit, the human's answer and the CI re-pause publish are all commits on `main`, so `main` always moves between asking and applying. That would break the note's "no livelock" requirement and its re-answer-lands test. Everything under `work/` is ledger (questions, answers, task moves), so only changes outside it count. Alternatives I rejected: a plain sha compare (always re-stales), and ignoring only this item's own sidecar and body (re-stales whenever any other item's question activity lands). `agent-stop.ts` deliberately avoids a `work/` exclusion, but that answers a different question (whether a work branch carries real deliverables), so the two do not conflict. This affects what `--strict-merge-approval` does for users; the CLI help and config docs now say so. It is a single `diff-tree` pathspec in `approvedBaseMoved`, so it is easy to change.
- **Legacy entries:** a merge entry without `askedAtMain` never re-stales. The forward note asked for this. It also applies to a follow-up whose producer could not supply a sha, which in practice is only a test stub.
- **Failures fail open:** if the mirror fetch fails or the recorded base is unknown (for example after a force-push), the check reports not stale. This keeps the old `mergeBaseMoved` policy; the red re-verify on the rebased tip is still the safety net.
- **Field name `askedAtMain`, not `base`:** `baseSha` already means the lock job's `main` in the CI lock outputs. The field is a generic optional one on `SidecarEntry`, and today only merge entries set it.
- **Which base the CI follow-up records:** the apply job's fresh `main`, taken from its worktree's HEAD before the re-pause is published, rather than the `main` the agent job compared against. That is the `main` the human actually sees the follow-up against. This leaves the `merge-restale` handoff row unchanged: still no bundle and no products.
- **The check fetches `main` into the hub mirror once more before `createJob`,** and only when strict mode is on and a base is recorded. That costs one extra fetch, but it is what lets the check run before the rebase without changing `createJob`.
