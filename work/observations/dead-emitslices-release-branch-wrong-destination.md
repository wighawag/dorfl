---
title: The lock-release emitSlices branch (slicing-lock.ts releaseAttempt) is dead AND wrong-destination — it still does slicing/ → prd/ (the pre-folder-lifecycle destination), never prd-sliced/, and has no live caller; a trap for the next author who wires emitSlices into a release
date: 2026-06-08
status: open
---

## The signal

Surfaced across the `slicing-coherence` folder chain (Step A `prd-sliced-folder-step-a` raised it; Step B `remove-sliced-marker-step-b` confirmed it persists). In `src/slicing-lock.ts` (`releaseAttempt`), the `emitSlices`/`markSliced`-gated branch still:

- restores the held PRD `git mv work/slicing/<slug>.md → work/prd/<slug>.md` — the **OLD destination**, NOT `work/prd-sliced/` (the new source of truth Step A introduced), and
- (before Step B) also wrote the `sliced:` marker there.

Step B removed the `markSliced`/marker half but LEFT the `emitSlices` half (the `slicing/ → prd/` move), because both folder-chain slices inherited the keystone's scope fence: **"do NOT touch the slicing LOCK semantics."**

## Why it is non-blocking today

The branch is **LATENT — it has no live caller.** Verified across both reviews: since the keystone (`slice-output-through-integration`), `performSlice` routes the SUCCESS path through `stageSlicingLifecycle` → `performIntegration`, which owns the lifecycle move (now `slicing/ → prd-sliced/`). `emitSlices` is only ever passed to `stageSlicingLifecycle`, NEVER to `releaseSlicingLock`. So the lock-release's `emitSlices` branch is dead code; it changes no runtime behaviour.

## Why it is still a trap

It is **dead AND wrong-destination**: if a future author wires `emitSlices` into a `releaseSlicingLock` call (reasonably assuming the lock release still owns slice emission, as it did pre-keystone), the PRD would land in `work/prd/` — the pre-folder-lifecycle destination — silently CONTRADICTING the `prd-sliced/` source of truth. A latent branch that does the wrong thing is worse than one that does nothing: it reads as "supported."

## Suggested follow-up (a small cleanup slice)

DELETE the dead `emitSlices` branch from `slicing-lock.ts:releaseAttempt` (and any now-unused `emitSlices`/`markSliced` params on `releaseSlicingLock` / `ReleaseSlicingLockOptions` that only that branch consumed), so the lock release owns ONLY the lock CAS + the `slicing/ → needs-attention/` redirect, and the success-path lifecycle move lives solely in `stageSlicingLifecycle` (→ `prd-sliced/`). This is the natural completion of the keystone's "only the OUTPUT path changes" — the lock-release's vestigial output limb. It was deferred (not done) by both folder-chain slices under the lock scope fence; it deserves its own small slice rather than riding an unrelated one.

Scope when sliced: pure dead-code removal + the wrong-destination trap; no behaviour change (the branch is unreachable). Mirror the clean-rename/clean-delete precedent. Confirm via grep that nothing passes `emitSlices`/`markSliced` to `releaseSlicingLock` before deleting.

## Related

- `review-nits-prd-sliced-folder-step-a-2026-06-08.md` (#2) — first flagged the dead-but-wrong-destination branch, asked Step B / a follow-up to own it.
- `review-nits-remove-sliced-marker-step-b-2026-06-08.md` (#2) — confirmed Step B removed the marker half but left the `emitSlices` move half; recommended tracking a follow-up slice. This observation IS that tracking note.
- `work/done/slice-output-through-integration.md` — the keystone whose scope fence ("do NOT touch the slicing LOCK semantics") correctly deferred this.
