---
title: the stranded-done auto-recover must fire ONLY when there is NOTHING TO COMMIT — gate committedRecovery on a clean tree so a CONTINUE with new agent work takes the normal build+commit path and is never DISCARDED
slug: recover-autodetect-gated-on-nothing-to-commit
prd: recover-autodetect-and-advancing-lock-crash-safety
blockedBy: []
covers: [1, 2, 3]
---

## What to build

Gate the autonomous stranded-done auto-recover so it cannot discard a continue-agent's new work. Today the auto-detect in `complete.ts` sets `committedRecovery` purely from BRANCH FOLDER STATE (`!onInProgress && !onNeedsAttention && onDone`). The recover path (`recoverAlreadyCommitted` in the integration core) SKIPS the `git add -A` + commit step and only rebases+integrates the ALREADY-committed kept tip. So on a CONTINUE (a requeued slice whose prior attempt already done-moved the slice into `done/` on the kept branch), the predicate fires even when the agent just produced NEW, uncommitted work this run — and that work is silently discarded.

Fix: `committedRecovery` may be true ONLY when this run produced NO UNCOMMITTED WORKING-TREE work AND the branch is done-stranded. The precise disambiguator is **whether the WORKING TREE is dirty with new source edits this run** — i.e. `git status --porcelain` over non-`work/` source paths (catching the agent's unstaged + untracked edits, excluding the runner's job-record), the SAME working-tree predicate the `isWorkBranchDiffEmpty` helper's FIRST half uses (`src/agent-stop.ts` runs exactly that porcelain check with the `:(exclude)work` + job-record exclusions). Dirty working tree ⇒ the agent produced new work this run ⇒ do NOT recover.

> CRITICAL — TWO traps, both verified against the code:
>
> 1. Do NOT use the core's `nothingStaged` helper. It is `git diff --cached --quiet` (INDEX only) and works in the core ONLY because the core calls it AFTER `git add -A` (integration-core.ts step 3). At the `complete.ts` auto-detect point (BEFORE `performIntegration`) the agent's edits are UNSTAGED, so `nothingStaged` reads "nothing staged" = true and the recover would STILL mis-fire — the bug survives. Use the WORKING-TREE porcelain check, not the index check.
>
> 2. Do NOT gate on the FULL `isWorkBranchDiffEmpty(...)`. Its SECOND half (`hasSourceCommitsAhead`: counts non-`work/` commits in `<arbiter>/main..HEAD`) returns "has work" for a GENUINE STRAND too — a stranded-done branch by definition carries its implementation SOURCE COMMITS ahead of main. So `!isWorkBranchDiffEmpty` is true for BOTH a dirty continue AND a clean genuine strand, which would WRONGLY BLOCK the legitimate recover (breaking story 2). Use ONLY the WORKING-TREE-dirty half (the uncommitted-edits porcelain check), NOT the commits-ahead half. If a shared helper is desired, EXTRACT the working-tree-dirty predicate (the porcelain half) so both `isWorkBranchDiffEmpty` and this gate share it, rather than calling the composite.

The result:

- **Dirty tree (agent produced work)** ⇒ recover is NOT taken; the normal build→gate→done-move→commit→integrate path runs, so the new work lands.
- **Clean tree + done-stranded tip (a genuine finished strand)** ⇒ recover the kept commit (the original `autonomous-path-auto-recovers-already-committed-stranded-branch` behaviour, preserved).

This keys off the working-tree/branch source state (via `isWorkBranchDiffEmpty`), needs NO agent signal, NO claim-base comparison, and NO onboard-decision threading. The explicit `complete --isolated <slug>` surface (which deliberately recovers a stranded worktree and sets `committedRecovery` directly via `recover-isolated.ts`) is UNCHANGED — this narrows only the autonomous auto-detect path.

## Acceptance criteria

- [ ] A CONTINUE with new uncommitted work on a kept branch whose slice is already in `work/done/` takes the NORMAL build path: the new work is committed + done-moved + integrated, NOT discarded by auto-recover. A throwaway-git fixture reproduces the live incident (agent edits a file on a kept done-stranded branch; assert the integrated result CONTAINS the new edit) — covers story 1.
- [ ] A genuine FINISHED STRAND (clean tree, no new work this run, tip ahead of `<arbiter>/main`, slice in `done/` on the branch) STILL auto-recovers the kept commit (no rebuild) — the original slice-1 behaviour is preserved. A test pins this — covers story 2.
- [ ] The disambiguator is the WORKING-TREE-DIRTY check ONLY (the `git status --porcelain` over non-`work/` paths half of `isWorkBranchDiffEmpty`) — NOT the index-only `nothingStaged` (reads empty before `git add -A`, so it misses the agent's unstaged edits), NOT the FULL `isWorkBranchDiffEmpty` (its commits-ahead half is true for a genuine strand too, which would wrongly block the legitimate recover and break story 2), and NOT folder + tip-ahead alone. A test pins BOTH: a dirty continue does NOT recover (story 1) AND a clean genuine strand whose kept tip has source commits ahead STILL recovers (story 2). A comment documents why neither `nothingStaged` nor the full `isWorkBranchDiffEmpty` is correct here.
- [ ] `complete --isolated <slug>` (the explicit stranded-worktree recover via `recover-isolated.ts`) is UNCHANGED — a test confirms the isolated recover still integrates the kept commit (it sets `committedRecovery` directly, not via the auto-detect) — covers story 3.
- [ ] An already-integrated tip (clean tree, tip already reachable on `<arbiter>/main`) is STILL a clean no-op (never a re-push/double-integrate) — the core's unspoofable `isAncestor` no-op is not regressed.
- [ ] Tests cover the new behaviour in the repo's existing throwaway `--bare` `file://` arbiter + real-clone style; point `workspacesDir` at a temp dir; no network.
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None — can start immediately. This is the urgent data-loss fix; it touches `complete.ts` only and is independent of the advancing-lock work (slices B/C).

## Prompt

> FIRST, drift-check against current `origin/main`: re-read `src/complete.ts` source-resolution where `committedRecovery` is computed (the merged line is `const committedRecovery = !onInProgress && !onNeedsAttention && onDone;` ~L476, with the `>> recovered a stranded already-complete branch …` note just below); `src/integration-core.ts` (`committedRecovery` input ~L215, dispatch ~L490, `recoverAlreadyCommitted` ~L1352 — it SKIPS the build/done-move/commit and rebases the kept tip; note the `nothingStaged` / `git add -A` done-commit step the normal path uses ~step 3); `src/do.ts` (the agent runs BEFORE `performComplete` and leaves edits UNCOMMITTED — the core's step-3 commit captures them); `src/recover-isolated.ts` (~L178 sets `committedRecovery: true` directly — the explicit surface to leave UNCHANGED). Confirm the data-loss flow still holds: a dirty-tree continue on a done-stranded branch currently auto-recovers and discards the uncommitted work. If the auto-detect already gates on a clean tree, route to needs-attention noting that.
>
> GOAL: gate the AUTONOMOUS stranded-done auto-recover so `committedRecovery` is true ONLY when the WORKING TREE is clean of new source edits this run AND the branch is done-stranded. A dirty working tree (agent produced new work this run) MUST take the normal build→commit→integrate path so the work lands; a clean done-stranded tip recovers the kept commit (slice-1 behaviour preserved). Use the WORKING-TREE-dirty predicate ONLY — the `git status --porcelain` over non-`work/` paths half of `isWorkBranchDiffEmpty` (`agent-stop.ts`). Two traps to avoid (both verified): (1) NOT the core's `nothingStaged` (`git diff --cached --quiet`, INDEX-only) — the agent's edits are UNSTAGED at the `complete.ts` auto-detect point (the core only `git add -A`s LATER), so it reads empty and the recover mis-fires; (2) NOT the FULL `isWorkBranchDiffEmpty` — its `hasSourceCommitsAhead` half is true for a GENUINE STRAND (the kept tip carries source commits ahead of main), so the composite would WRONGLY BLOCK the legitimate recover and break story 2. Prefer EXTRACTING the working-tree-dirty half into a shared predicate over calling the composite. Do NOT thread an agent signal or onboard decision.
>
> WHY: a live `advance` continuing a requeued slice LOST the agent's Gate-2 fix because the folder-only auto-detect fired on a dirty continue and the recover path skipped the commit. See `work/observations/recover-already-committed-discards-continue-agent-new-work.md` and the PRD `recover-autodetect-and-advancing-lock-crash-safety`.
>
> FENCE: do NOT change `recover-isolated.ts` (the explicit `complete --isolated` surface stays as-is). Do NOT touch `advancing-lock.ts` / `advance.ts` (that is the sibling crash-safety slice). Do NOT regress the `already-integrated` clean no-op (the core's `isAncestor` unspoofable check).
>
> SEAM TO TEST AT: the autonomous integrate path (`performDo`/`performComplete`) with throwaway `--bare` `file://` arbiters + real clones — (a) dirty-tree continue on a done-stranded branch ⇒ new work integrated (not discarded); (b) clean done-stranded tip ⇒ kept commit recovered (no rebuild); (c) `complete --isolated` ⇒ unchanged; (d) already-integrated clean tip ⇒ no-op. Point `workspacesDir` at a temp dir; no network.
>
> DONE: auto-recover fires only on a clean tree + done-stranded branch, a dirty continue lands its new work, the isolated recover + the already-integrated no-op are unchanged, the incident is covered by a regression test, and `pnpm -r build && pnpm -r test && pnpm format:check` is green. Do NOT perform git transitions (no stage/commit/push, no folder moves) — the runner/human owns those.
