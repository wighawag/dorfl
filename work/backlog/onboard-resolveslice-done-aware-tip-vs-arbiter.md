---
title: onboard resolveSlice finds a slice in done/ on a CONTINUE (safely) — a done/ slice that is STRANDED (tip not on arbiter) is re-onboardable; a genuinely-COMPLETE one (tip reachable on arbiter) is NOT, disambiguated by tip-vs-arbiter, never folder alone
slug: onboard-resolveslice-done-aware-tip-vs-arbiter
prd: ledger-integrity
blockedBy: []
covers: [5]
---

## What to build

Teach the onboard find-slice (`resolveSlice` in `prompt.ts`) to find a slice that is in `done/` on a CONTINUE/re-claim, so a continue onto an already-done-moved branch doesn't fail with "no slice found in work/in-progress/ or work/backlog/" (defect 3, story 5) — WITHOUT ever re-onboarding a genuinely-complete slice.

Today `resolveSlice`'s resolution order is `['in-progress', 'backlog']`, blind to `done/`. When a continue/re-claim lands on a branch whose slice was already done-moved (the green-but-unpushed strand state), onboard fails to find the slice. The conductor hand-moved the slice `done/ -> in-progress/` on the branch to work around it this drive.

The SAFETY CRUX (the PRD's hard constraint): a `done/` slice is folder-indistinguishable between two states — genuinely COMPLETE (work integrated) vs STRANDED (committed-but-unpushed strand). The disambiguation MUST be by TIP-vs-ARBITER state, NOT folder name:

- work-branch tip REACHABLE on `<arbiter>/main` => COMPLETE => do NOT re-onboard (a careless `done/`-accepting onboard could re-run a finished slice — the hazard story 6's slice fenced this out to avoid).
- work-branch tip committed-but-NOT-on-the-arbiter => STRANDED => re-onboardable (the continue is legitimate).

The reachability predicate already exists in the codebase: `gc.ts`'s `isAncestor` / `git merge-base --is-ancestor <tip> <arbiter>/main` (the reaper's "reachable on the arbiter" notion). REUSE it; do not invent a second reachability check. Add `done/` to the find-slice resolution ONLY behind this tip-vs-arbiter gate, so a complete slice is never re-onboarded.

This is the SEPARATE, hazardous slice that `finish-already-committed-branch` (story 6) explicitly fenced OUT ("Leave `prompt.ts` untouched"). It is file-orthogonal to that slice (it touches ONLY `prompt.ts` `resolveSlice`; story 6 touches the integration core + workspace resolution and does NOT touch `prompt.ts`), so they can land independently.

## Acceptance criteria

- [ ] `resolveSlice` finds a slice in `done/` on a continue ONLY when it is genuinely STRANDED: the work-branch tip is committed-but-NOT-reachable on `<arbiter>/main`. The disambiguation is by tip-vs-arbiter reachability, NEVER folder name alone.
- [ ] A genuinely-COMPLETE `done/` slice (work-branch tip REACHABLE on `<arbiter>/main`) is NOT re-onboarded — onboard does not resurrect a finished slice. (A test asserts this: a complete slice in `done/` is NOT picked up by the continue onboard.)
- [ ] The reachability check REUSES the existing primitive (`gc.ts`'s `isAncestor` / `merge-base --is-ancestor <tip> <arbiter>/main`) — no second, divergent reachability implementation.
- [ ] The existing `in-progress`/`backlog` resolution is UNCHANGED (those remain found as before; `done/` is added only behind the stranded gate, and only on a continue, not a fresh claim).
- [ ] Tests REPRODUCE both `done/` states in a throwaway-git fixture: (a) a STRANDED slice (slice in `done/` on the branch, tip not on the arbiter) is resolved by the continue onboard; (b) a COMPLETE slice (tip reachable on `<arbiter>/main`) is NOT. Plus the unchanged in-progress/backlog cases still pass.
- [ ] Tests cover the new behaviour in the repo's existing vitest style; no shared/global location touched outside temp fixtures.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. File-orthogonal to `finish-already-committed-branch` (this touches ONLY `prompt.ts` `resolveSlice`; that slice fences `prompt.ts` out). The tip-vs-arbiter reachability primitive it reuses (`gc.ts` `isAncestor`) is already landed.

## Prompt

> Teach agent-runner's onboard find-slice (`resolveSlice` in `packages/agent-runner/src/prompt.ts`) to find a slice in `done/` on a CONTINUE — safely (story 5 of the ledger-integrity PRD, `work/prd-sliced/ledger-integrity.md`, possibly in `work/slicing/` until this slicing lands; defect 3). Today `resolveSlice`'s order is `['in-progress','backlog']`, blind to `done/`, so a continue onto an already-done-moved branch fails with "no slice '<slug>' found in work/in-progress/ or work/backlog/" (the conductor hand-moved the slice `done/ -> in-progress/` on the branch to work around it).
>
> FIRST, check this slice against current reality (launch snapshot — WORK-CONTRACT.md "Drift is a needs-attention signal"). Confirm `resolveSlice` is still `['in-progress','backlog']`-only, and that `packages/agent-runner/src/gc.ts` still exposes the reachability check (`isAncestor` / `git merge-base --is-ancestor <tip> refs/remotes/<arbiter>/main`). If a dependency landed differently, reconcile or route to `needs-attention/`.
>
> SAFETY CRUX (the whole point): a `done/` slice is folder-indistinguishable between COMPLETE (integrated) and STRANDED (committed-but-unpushed). Disambiguate by TIP-vs-ARBITER, never folder: tip REACHABLE on `<arbiter>/main` => COMPLETE => do NOT re-onboard; tip committed-but-NOT-on-the-arbiter => STRANDED => re-onboardable. A careless `done/`-accepting onboard could re-run a finished slice — that is exactly why `finish-already-committed-branch` (story 6) fenced `prompt.ts` OUT and deferred it to THIS slice. REUSE `gc.ts`'s `isAncestor` — do not invent a second reachability check.
>
> BUILD: add `done/` to `resolveSlice`'s resolution ONLY behind the stranded (tip-not-on-arbiter) gate, only on a continue; leave the `in-progress`/`backlog` resolution unchanged. This slice touches ONLY `prompt.ts` `resolveSlice` (file-orthogonal to story 6).
>
> TEST (TDD, vitest, house style — throwaway git repos, temp dirs, real shared dirs untouched): (a) a STRANDED slice (slice in `done/` on the branch, tip not on the arbiter) IS resolved by the continue onboard; (b) a COMPLETE slice (tip reachable on `<arbiter>/main`) is NOT re-onboarded; (c) the existing in-progress/backlog cases still pass.
>
> "Done" = `resolveSlice` resolves a STRANDED `done/` slice on a continue but never a COMPLETE one (tip-vs-arbiter via the reused `gc.ts` reachability), the in-progress/backlog behaviour unchanged, both `done/`-state tests + the no-regression tests, and the gate green.
