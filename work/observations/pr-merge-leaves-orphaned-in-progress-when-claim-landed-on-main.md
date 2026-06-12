---
title: a slice's done-move is a COPY not a MOVE across the merge boundary — when the CLAIM put `work/in-progress/<slug>.md` on the arbiter main, a PR/recovery branch can ADD `work/done/<slug>.md` WITHOUT removing the in-progress copy, leaving an ORPHANED in-progress ledger entry after merge
date: 2026-06-12
status: open
---

## The signal

After PR #86 (`review-comment-fallback-on-unparsed-pr-url`) merged, the slice was present in BOTH `work/done/` AND `work/in-progress/` on main (byte-identical copies). The orphaned `in-progress/` ghost made an ALREADY-DONE slice look claimable/recoverable — a later drive treated it as "stranded green work awaiting recovery" and spent investigation effort discovering it was simply already merged. A stale in-progress entry is a latent trap: it falsely advertises a completed slice as in-flight.

## Root cause (traced precisely, not guessed)

The done-move (`git mv work/in-progress/<slug>.md → work/done/<slug>.md`) was NOT atomic with the integration against the arbiter's actual in-progress state. The exact commit topology:

- The CLAIM commit (`9c5fb29`) was pushed DIRECTLY to the arbiter main (claims are tree-less CAS pushes to main, independent of any PR) → this put `work/in-progress/<slug>.md` ON MAIN. Verified: `9c5fb29` has `in-progress/`, no `done/`.
- The PR commit (`93ef12c`, `#86` — a HAND-BUILT recovery branch from one of the session's manual stale-lease recoveries) has parent `9c5fb29` and its tree contains **BOTH** `in-progress/` AND `done/` for the slug. Verified: `93ef12c` has `in-progress/` AND `done/`.
- So `#86` ADDED `done/` but never DELETED `in-progress/`. The "move" became a "copy".

Why the delete was lost: the recovery branch was assembled by `git checkout <other> -- <files>` + a `git mv` whose SOURCE folder did not match the base the squash actually diffed against (`9c5fb29`, which had the slice in `in-progress/`). The net `work/`-folder diff applied by the merge added `done/` without removing `in-progress/`. The general failure mode: **whenever the claim's `in-progress/` is live on the arbiter main, but the integrating branch computes its done-move against a DIFFERENT base (a hand-built recovery branch, a stale branch, a branch that already had `done/`), the squash-merge can land `done/` while leaving the `in-progress/` ghost.**

## Why it matters / how it compounds

- A stale `in-progress/<slug>.md` makes a completed slice read as claimable/in-flight to `scan`/`status`/a conductor → wasted recovery investigation (it happened), or worse a double-claim/re-build of already-merged work.
- It is invisible unless someone notices the duplicate; nothing in the protocol asserts "a slug lives in exactly ONE status folder".
- It is the ledger-integrity sibling of the `prompt.ts` onboard blind spot and the stranded-green-work class: the lifecycle folder is the source of truth, so a slug in two folders is a corrupt ledger.

## The fix (layered)

1. **Make the done-move ATOMIC with the integration against the arbiter's CURRENT state, never a copy.** The integration core's done-move must compute `git mv FROM the slug's actual current status folder on the arbiter main` (in-progress OR needs-attention) `TO done/` as one staged rename, so the merged result can never contain both. A hand-built/recovery branch must do the same (resolve the real source folder, `git mv`, not `add done/`). This is the same "operate against the arbiter's current ledger state" principle the tree-less requeue (#89) already uses for its move.
2. **Add a one-slug-one-folder INVARIANT + guard.** A cheap check (in `complete`/the integration tail, and/or a `status`/`scan` lint) that a slug never appears in two status folders simultaneously; on an integration that would leave a duplicate, FAIL loudly (or auto-clean the stale source) rather than silently land both. A `scan`/`status` warning when a slug is found in >1 folder would surface any existing/future orphan.
3. **(belt) a `gc`-style ledger sweep** that detects + reports (never auto-deletes without confirmation) any slug present in multiple `work/` status folders, so an orphan from a past merge is findable.

Fix #1 is the root-cause fix (the merge can't create the orphan); #2 is the cheap invariant that catches it if #1 is ever bypassed (a hand recovery, a future code path).

## Where

`src/integration-core.ts` (`performIntegration`'s done-move step — make it a resolve-source-then-`git mv`, atomic with the merge); `src/complete.ts` (source-folder resolution); the claim path (`claim`/`start.ts`) for understanding why `in-progress/` is on main independent of the PR; a new `status`/`scan` one-slug-one-folder lint. Incident: PR #86's merged tree had the slug in both `in-progress/` and `done/`; cleaned manually by the drive in commit `279b542` (a tree-less 1-file deletion). Cross-ref: `requeue-and-recovery-assume-local-checkout-no-remote-arbiter-form.md`, `finish-already-committed-branch.md` (the stranded-green-work re-scope), and the `prompt.ts` onboard blind spot noted there.
