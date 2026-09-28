---
title: 'A task that lands after a needs-attention recovery does not keep needsAnswers: true or a stranded question sidecar'
slug: a-recovered-task-lands-without-stale-question-state
blockedBy: []
---

## What to build

Every task in the CI-split drive that was surfaced to needs-attention and then recovered (requeue, or a re-dispatch continuing from the kept branch) landed in `work/tasks/done/` still carrying `needsAnswers: true` in its frontmatter (for example `ci-split-handoff-artifact-format`, `ci-split-build-path`, `ci-split-agent-result-and-reruns`, `ci-split-landed-vs-gated-report`). The surface set the flag on `main`, and the done-move carried it along. The matching question sidecar was drained later by a separate "drain stranded question state ... (terminal on main)" commit on the next claim, and `work/questions/task-ci-split-docs-drift-and-rollout.md` is still stranded because no claim ran after it. The flag is inert on a done item, but it is false information in the ledger and it misleads any reader or tool that scans `needsAnswers`.

When a task transitions to `done/` (or another terminal folder), clear `needsAnswers` and drain the item's own stuck/needs-attention sidecar in the same land, on every land path (propose and merge, laptop and the CI apply phase). Also clean up the current state of this repository's ledger once (the done files above and the stranded sidecar) as part of the change.

> FORWARD-NOTE (conductor, 2026-09-28): the ledger examples above are already out of date, and that is expected, not drift. The existing "drain stranded question state ... (terminal on main)" reconcile (`needs-attention.ts`) ran on later claims and rewrote each named done file to `needsAnswers: false`, and drained `work/questions/task-ci-split-docs-drift-and-rollout.md` (commit 2395adf6). The defect this task fixes still holds: the flag and the sidecar survive the LAND itself and are only cleaned by a LATER claim, so the ledger is wrong in between and stays wrong when no claim follows. For the one-off cleanup criterion, re-scan `main` when you build (at the time of this note, `work/tasks/done/advance-tick-classifier.md` still carried `needsAnswers: true`) rather than relying on the list above. A cleared flag may be removed or set to `false`; record which in your Decisions. A fresh instance confirms the defect is live: `generated-models-json-references-the-key-env-var` landed via #429 with `needsAnswers: true` and a stranded `work/questions/task-...` sidecar (its gate had bounced once), and both stayed wrong on `main` until the NEXT claim's reconcile drained them (commit 35a5d600).

## Acceptance criteria

- [ ] Landing a task that was surfaced and then recovered leaves no `needsAnswers` in the done file and no sidecar under `work/questions/` (tested on the land primitive, merge and propose).
- [ ] A task that lands normally is unchanged.
- [ ] This repository's `work/tasks/done/` holds no `needsAnswers: true` and `work/questions/` holds no sidecar for a terminal item after this task.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: stop recovered tasks from landing with stale question state. Read the done-move in the land path (`integration-core.ts`, `complete.ts`), the surface that sets `needsAnswers` (`surfaceStuckToNeedsAttention`), and the 'drain stranded question state' reconcile that runs on the next claim. Prefer doing it in the done-move commit itself.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **The flag is set to `needsAnswers: false`, not removed.** This matches what the claim-time reconcile already writes, so the two never disagree. Removing the key was the alternative (the forward-note allows either). It touches only the landing task's done record.
- **An answered or unparseable sidecar is left alone, and so is the flag.** This matches the reconcile's `answeredHeld` rule: a human's answer is data the tool did not write, and the answered-merge apply rung (which also uses the recovery tail) owns that sidecar. The alternative was to delete every sidecar on land. It affects the committed-recovery path, which the answered-merge apply rung shares.
- **Residue brought in by a rebase is amended into the tip commit, not added as a separate commit.** The prompt preferred doing it in the done-move commit, and after the rebase the tip is that commit. It is skipped when HEAD is already on `<arbiter>/main`, so a commit that isn't ours is never rewritten. If this fails it logs a note and the land goes ahead, with the claim-time reconcile as backstop. It touches the build path, the merge retry loop (and so the CI apply phase) and the stranded-branch recovery.
- **The claim-time reconcile stays in place as a backstop.** It still cleans up old residue and items that reach a terminal folder by other routes. The alternative was to remove it now that the land cleans up after itself.
