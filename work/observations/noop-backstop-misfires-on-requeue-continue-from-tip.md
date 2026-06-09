---
title: The empty-diff no-op backstop misfires on a requeue continue-from-tip — committed prior work reads as "no source change" and re-routes a GREEN slice to needs-attention without ever opening its PR
date: 2026-06-08
status: open
---

## The signal

Noticed while conducting the `slicing-coherence` chain (`drive-backlog`). The KEYSTONE slice `slice-output-through-integration` was fully built and is provably GREEN (`pnpm -r build` + `pnpm -r test` 1050/1050 + `pnpm -r format:check`), but the runner would not open its PR. Two guard rails sat between a correct branch and its PR:

1. The build `do` run's FINAL acceptance gate hit the KNOWN flaky test `review-gate.test.ts > … null/shell {model} placeholder` (`spawnSync bash EPIPE` under parallel load — see `review-gate-test-epipe-under-parallel-load.md`, now a 4th sighting). The flake reds the gate → routes to needs-attention → no PR.
2. Recovery via `requeue` (keep+continue, branch preserved) + re-`do` then hit the **no-op backstop**: the re-claim continued from the kept (already-complete) branch tip, the agent correctly produced NO NEW change, and `isWorkBranchDiffEmpty` reported "empty" → routed to needs-attention WITH `emptyDiffStopReason` ("the agent produced no source change … treating as a no-op/stop") — again BEFORE the gate / PR step.

So a flake-recovered slice can never re-mint its PR via `do`: build-then-flake gave no PR, and continue-from-tip short-circuits at the no-op guard before the gate. A catch-22 between two otherwise-correct guards.

## Root cause (the exact seam)

`isWorkBranchDiffEmpty` (`src/agent-stop.ts`) is **working-tree-only by design**. Its doc-comment states the assumption explicitly:

> At this point in the pipeline … the runner has committed nothing of the agent's work — the work branch HEAD is still the CLAIM commit, so the agent's output sits ENTIRELY in the WORKING TREE.

That assumption is TRUE for a fresh build (HEAD == claim commit, all agent output uncommitted) but FALSE for a **requeue continue-from-tip**: there the kept branch's prior work is already a chain of COMMITTED commits ahead of `<arbiter>/main`, the working tree is clean, and `git status --porcelain` is legitimately empty. The backstop confuses "the agent added nothing THIS session" (true, and CORRECT — the work was already done) with "this build produced no source change" (false — the branch carries 720 lines of real, green work).

`requeue`'s own contract names the continuation explicitly ("leaving the `work/<slug>` branch UNTOUCHED so the next claim CONTINUES from its tip"), so the two seams disagree: requeue promises continuation, the no-op backstop assumes a from-scratch working tree.

## Fix direction (maintainer-suggested 2026-06-08)

Make the no-op check consider **commits on the branch not in `<arbiter>/main`**, not just the working tree. Concretely: the build is a genuine no-op IFF the working tree carries no source change (today's check) AND `git rev-list <arbiter>/main..HEAD` contains no commit that touches a non-`work/` path. If the kept branch already has prior source commits ahead of main (a continue-from-tip), it is NOT a no-op — it should flow to the gate + PR even when the current session added nothing. (Equivalently: diff `<arbiter>/main...HEAD` for source paths, not just `git status`.)

This keeps the fresh-build behaviour identical (HEAD == claim commit ⇒ no source commits ahead ⇒ same verdict as today) while letting a flake-recovered, already- complete branch reach its PR. Note the `arbiter` param is ALREADY threaded into `isWorkBranchDiffEmpty` (today unused — "accepted for call-site symmetry … and possible future strategies") — this is exactly that future use, so the signature need not change.

Care: keep filtering the `work/` ledger and `.agent-runner-job.json` out of the commit-range check too (the claim commit touches `work/` only and must still read as "no source"). And keep the working-tree check as the primary signal for the common fresh-build path.

## Why it matters

Without this, the documented recovery loop in the `drive-backlog` / `requeue`-continue contract is broken for the (common) case where the kept branch is ALREADY done-and-green: the slice can be recovered to backlog but can never be re-driven to a PR through `do`, forcing a manual `gh pr create` from the preserved branch (what the conductor did this session as the immediate unblock). The fix restores `requeue + re-do` as a closed loop for flake-reds.

## Related

- `review-gate-test-epipe-under-parallel-load.md` — the flake that triggered the recovery in the first place (and the gate-serialisation question it raises).
- The keystone branch `origin/work/slice-output-through-integration` holds the green work this misfire stranded.
