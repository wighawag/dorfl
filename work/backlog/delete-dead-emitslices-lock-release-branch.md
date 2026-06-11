---
title: delete the DEAD + wrong-destination `emitSlices` branch in slicing-lock.ts releaseAttempt (it still does slicing/ → prd/, never prd-sliced/, and has NO live caller) so the lock release owns only the CAS + the needs-attention redirect
slug: delete-dead-emitslices-lock-release-branch
blockedBy: []
covers: []
---

## What to build

Delete the dead `emitSlices` limb from the slicing-lock release path. Since the `slice-output-through-integration` keystone, the SUCCESS slicing transition routes through `stageSlicingLifecycle` → `performIntegration`, which owns the lifecycle move (now `slicing/ → prd-sliced/`). `emitSlices` is only ever passed to `stageSlicingLifecycle`, NEVER to `releaseSlicingLock` — so the `emitSlices` branch inside `slicing-lock.ts`'s `releaseAttempt` is **dead code**.

It is also **wrong-destination**: that branch restores the held PRD with `git mv work/slicing/<slug>.md → work/prd/<slug>.md` — the PRE-folder-lifecycle destination, NOT `work/prd-sliced/` (the current source of truth). A future author who wires `emitSlices` into a `releaseSlicingLock` call (reasonably assuming the lock release still owns slice emission, as it did pre-keystone) would land the PRD in `work/prd/`, silently contradicting the `prd-sliced/` source of truth. A latent branch that does the WRONG thing is worse than one that does nothing — it reads as "supported".

### Precise scope

- **Re-confirm the dead-ness FIRST** (this is a launch snapshot — verify before deleting): grep that nothing passes `emitSlices`/`markSliced` to `releaseSlicingLock`. As of authoring, `src/slicing.ts` passes `emitSlices` only to `stageSlicingLifecycle` (the `stage:` callback), and `slicing-lock.ts`'s `releaseAttempt` consumes `emitSlices` only in the success `else` limb that does the `slicing → prd` move. If that is no longer true (someone re-wired it live), STOP and route to `needs-attention/` rather than deleting a now-live branch.
- DELETE the dead `emitSlices` writing loop from `releaseAttempt`'s success limb.
- REMOVE any now-unused `emitSlices` / `markSliced` params on `releaseSlicingLock` / `ReleaseSlicingLockOptions` / the internal `releaseAttempt` signature that ONLY that branch consumed. (Keep anything still used by a live caller — verify per-param.)
- After deletion, the lock release owns ONLY the lock CAS + the `slicing/ → needs-attention/` redirect; the success-path lifecycle move (→ `prd-sliced/`) lives solely in `stageSlicingLifecycle` / `performIntegration`.
- No behaviour change (the branch is unreachable) — this is the natural completion of the keystone's "only the OUTPUT path changes". Mirror the clean-delete precedent.

## Acceptance criteria

- [ ] A grep confirms NOTHING passes `emitSlices`/`markSliced` to `releaseSlicingLock` before any deletion (documented in the work, e.g. a comment or the PR body).
- [ ] The dead `emitSlices` branch (and any params only it consumed) are removed from `slicing-lock.ts`; the lock release retains only the CAS + the `slicing/ → needs-attention/` redirect.
- [ ] No behaviour change: the slicing success path still moves `slicing/ → prd-sliced/` via `stageSlicingLifecycle`/`performIntegration`; the needs-attention redirect still works. Existing slicing tests stay green unchanged (no test asserted the dead branch; if one did, that is itself evidence it was reachable — investigate before deleting).
- [ ] No dangling reference to the removed params anywhere (type-check clean).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. Pure cleanup; independent of advance-loop (it completes the slicing-coherence keystone's deferred limb).

## Prompt

> Delete the DEAD + wrong-destination `emitSlices` branch in `src/slicing-lock.ts`'s `releaseAttempt`. Since the `slice-output-through-integration` keystone (`work/done/`), the slicing SUCCESS path routes through `stageSlicingLifecycle` → `performIntegration` (which moves `slicing/ → prd-sliced/`). `emitSlices` is passed ONLY to `stageSlicingLifecycle`, NEVER to `releaseSlicingLock` — so the `emitSlices` limb inside `releaseAttempt` is dead. It is ALSO wrong-destination: it does `git mv work/slicing/<slug>.md → work/prd/<slug>.md` (the pre-folder-lifecycle destination, NOT `prd-sliced/`), a trap for a future author who re-wires `emitSlices` into the lock release.
>
> VERIFY FIRST, then delete: grep that nothing passes `emitSlices`/`markSliced` to `releaseSlicingLock` (today: `src/slicing.ts` passes `emitSlices` to `stageSlicingLifecycle` only; `slicing-lock.ts` consumes it only in the success `else` limb's `slicing → prd` move). If still dead, DELETE the branch and remove any `emitSlices`/`markSliced` params on `releaseSlicingLock`/`ReleaseSlicingLockOptions`/`releaseAttempt` that ONLY that branch consumed. If it is NO LONGER dead (someone re-wired it), route to `needs-attention/` instead.
>
> READ FIRST: `src/slicing-lock.ts` (`ReleaseSlicingLockOptions`, `releaseSlicingLock`, `releaseAttempt` — the `if (emitSlices)` loop in the success limb, ~the `slicing → prd` `git mv`); `src/slicing.ts` (`stageSlicingLifecycle` — where `emitSlices` legitimately lands now, and `performIntegration`'s `slicing/ → prd-sliced/` move); `work/done/slice-output-through-integration.md` (the keystone whose scope fence deferred this), `work/done/prd-sliced-folder-step-a.md` + `work/done/remove-sliced-marker-step-b.md` (the folder-lifecycle context).
>
> SEAM TO TEST AT: the existing slicing-lock / slicing tests — they must stay green unchanged (the branch is unreachable, so removing it changes no behaviour). If a test DID exercise the dead branch, that contradicts the dead-ness premise — investigate before deleting.
>
> "Done" = the dead `emitSlices` branch + its now-unused params are gone, the lock release owns only the CAS + `slicing/ → needs-attention/` redirect, no behaviour changed, type-check clean, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

## Source

Promotes `work/observations/dead-emitslices-release-branch-wrong-destination.md` (surfaced across the `slicing-coherence` folder chain; deferred by both folder-chain slices under the "do NOT touch the slicing LOCK semantics" scope fence). Re-confirmed dead + wrong-destination against current code at authoring.

---

### Claiming this slice

```sh
agent-runner claim delete-dead-emitslices-lock-release-branch --arbiter origin
git fetch origin && git switch -c work/delete-dead-emitslices-lock-release-branch origin/main
git mv work/in-progress/delete-dead-emitslices-lock-release-branch.md work/done/delete-dead-emitslices-lock-release-branch.md
```
