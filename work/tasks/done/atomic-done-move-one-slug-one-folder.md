---
title: atomic done-move resolved against the arbiter's current folder + one-slug-one-folder invariant (a transition that would leave a slug in two status folders FAILS loud)
slug: atomic-done-move-one-slug-one-folder
prd: ledger-integrity
blockedBy: []
covers: [1, 2]
---

## What to build

Make the integration done-move ATOMIC against the arbiter's CURRENT status folder, and enforce the one-slug-one-folder invariant on that transition so a merge can never land `done/` while leaving an `in-progress/` (or `needs-attention/`) ghost behind (defect 1 and its root, defect 2).

Today the integration core's done-move stages `git mv work/<source>/<slug>.md -> work/done/<slug>.md`, where `<source>` (`in-progress` | `needs-attention`) is resolved by the CALLER from HEAD's local/branch tree, NOT from the arbiter's actual current state. When the integrating branch's base diverges from the arbiter (a hand-built recovery branch, a stale branch, a branch that already carried `done/`), the squash-merge can ADD `done/` without REMOVING the stale source folder, leaving a ghost. The ghost makes a DONE slice read as claimable/in-flight, causing wasted recovery investigation or a double-claim (it happened: PR #86, hand-cleaned in `279b542`).

Change the transition so it RESOLVES the slug's actual current status folder from the ARBITER (fetch-first, the arbiter-is-truth rule) and moves it as ONE staged rename, never an `add done/` computed blind against a divergent base. Then assert the invariant: after the transition no slug exists in more than one `work/` status folder. If the transition would leave the slug in two folders, FAIL LOUD (preferred) — auto-cleaning the stale source is permitted ONLY when provably safe (identical content AND the canonical destination is unambiguous), mirroring the manual cleanup the drive did in `279b542`.

This is a HARDENING of the existing `ledgerWrite.applyTransition` / `applyCompleteTransition` CAS model (#89) and `performIntegration`'s done-move step — NOT a new ledger model and NOT a new lock. It threads through the SHARED integration core so `do`/`run`/`complete` all benefit without duplicating the logic.

The arbiter-resolved source folder must also flow into `complete.ts`'s source resolution (currently `in-progress` || `needs-attention`, resolved locally), so the source the done-move acts on is the one the arbiter actually holds.

## Acceptance criteria

- [ ] The integration done-move resolves the slug's CURRENT status folder from the arbiter (fetch-first) and renames it to `done/` as one staged move — never an `add done/` blind against a divergent base. A divergent integrating branch (base ahead/behind the arbiter for this slug) can no longer produce a `done/`-added-but-source-not-removed merge.
- [ ] ONE-SLUG-ONE-FOLDER invariant enforced on the transition: a transition that would leave the slug present in more than one `work/` status folder FAILS LOUD with an actionable message. Auto-clean of the stale source is permitted ONLY when provably safe (identical content + unambiguous canonical destination); otherwise it fails rather than silently picking one.
- [ ] The fix is in the SHARED integration core (reachable by `do`/`run`/`complete`) and reuses the existing tree-less CAS transition primitive (#89) — no second ledger model, no new lock, no duplicated done-move.
- [ ] `complete`'s source-folder resolution agrees with the arbiter-resolved source (no local-tree-only source that can disagree with what the arbiter holds).
- [ ] Tests REPRODUCE the ghost scenario in a throwaway-git fixture: a claim publishes `in-progress/<slug>` to the arbiter; an integrating branch computed against a DIFFERENT base done-moves the slug; the merge result has the slug in `done/` ONLY (no `in-progress/` ghost) — i.e. the move is a move, not a copy. Plus a test that the invariant guard FAILS LOUD when a slug is present in two folders pre-transition.
- [ ] Tests cover the new behaviour in the repo's existing vitest style (throwaway git repos; `GIT_CONFIG_GLOBAL=/dev/null` style isolation; point any workspace dir at a temp dir).
- [ ] No shared/global location touched outside temp fixtures.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green (this repo's gate).

## Blocked by

- None — can start immediately. This is the load-bearing seam; the lint slice and the finish-stranded-branch slice serialize AFTER it (they touch the same integration/transition code).

## Prompt

> Harden the dorfl `work/` ledger so the integration DONE-MOVE is atomic against the ARBITER's current status folder and the one-slug-one-folder invariant holds on that transition. This closes defect 1 (orphaned `in-progress/` after merge — a "move" became a "copy", PR #86, hand-cleaned in `279b542`) and its root, defect 2 (a transition could publish a slug in two folders). Source PRD: `work/prd-sliced/ledger-integrity.md` (read it for the full root-cause trace; it may be in `work/slicing/` until this slicing lands).
>
> FIRST, re-confirm the premises against CURRENT code (this slice is a launch snapshot and may have drifted — WORK-CONTRACT.md "Drift is a needs-attention signal"). Verify: `packages/dorfl/src/integration-core.ts` `performIntegration` still does the done-move as `git mv work/${source}/${slug}.md -> work/done/${slug}.md` with `source` resolved by the CALLER from the local tree (step 2, around the `lifecycle ? stage() : gitHard(['mv', ...])` branch); `packages/dorfl/src/complete.ts` still resolves source as `in-progress` || `needs-attention` locally; `ledgerWrite.applyTransition`/`applyCompleteTransition` (`packages/dorfl/src/ledger-write.ts`) is still the tree-less CAS primitive (#89). If a dependency landed differently, reconcile or route this slice to `needs-attention/` rather than building on a stale premise.
>
> DOMAIN: `work/` IS the ledger — a slice's STATUS is the FOLDER its single `.md` lives in (`backlog/` -> `in-progress/` -> `done/`, or `-> needs-attention/`); NO index, NO status frontmatter, ONE file per item (WORK-CONTRACT.md). The arbiter is the source of truth — every transition must resolve the slug's CURRENT folder from the arbiter (fetch-first), never from a possibly-divergent local/branch tree (the entanglement lesson). Reuse the tree-less CAS transition (#89) — do NOT introduce a second ledger model or a new lock.
>
> BUILD: (1) the done-move resolves the slug's current status folder from the ARBITER and renames to `done/` as one staged move, never `add done/` blind against a divergent base; (2) enforce one-slug-one-folder on the transition — FAIL LOUD if it would leave the slug in two folders, auto-cleaning the stale source ONLY when provably safe (identical content + unambiguous destination, mirroring the manual `279b542` cleanup); (3) make `complete`'s source resolution agree with the arbiter-resolved source. Keep it in the SHARED integration core so `do`/`run`/`complete` all reach it without duplicating the done-move.
>
> TEST (TDD, vitest, house style — throwaway git repos, `GIT_CONFIG_GLOBAL=/dev/null`-style isolation, temp workspace dirs, real shared dirs untouched): reproduce the ghost — claim publishes `in-progress/<slug>` to the arbiter, an integrating branch computed against a DIFFERENT base does the done-move, assert the merged ledger has the slug in `done/` ONLY (no `in-progress/` ghost); and assert the invariant guard FAILS LOUD when a slug pre-exists in two status folders.
>
> "Done" = the arbiter-resolved atomic done-move + the one-slug-one-folder loud-fail guard, both in the shared integration core reusing the #89 CAS, with `complete`'s source resolution aligned, the ghost-reproduction + invariant tests, and the gate green.

## Needs attention

PR/code review (Gate 2) blocked this work:
- run.ts does not handle the new 'invariant-violation' core outcome: it falls through to the SUCCESS branch and records the job as state:'done' / status:'claimed-done' with no prUrl. So when the one-slug-one-folder guard FAILS LOUD (the corrupt-ledger refusal that integrates nothing), the autonomous `run` daemon misreports it as a completed job — the opposite of fail-loud, and on the least-supervised caller. Route 'invariant-violation' to needs-attention (like 'rebase-conflict') or a distinct failed status, never claimed-done. (packages/dorfl/src/run.ts:762-783 maps only 'gate-failed', 'review-blocked', 'rebase-conflict'; the call at line 704 passes no `lifecycle`, so the guard at integration-core.ts:671-684 can return 'invariant-violation' to it. complete.ts:531 handles the variant correctly; run.ts does not.)
PR/code review (Gate 2) did not reach an approve verdict within reviewMaxRounds=2 round(s); forcing needs-attention (never silently merged or looped).

## Requeue 2026-06-13

Gate-2 BLOCK (real bug, continue from the kept branch — do NOT restart): the new 'invariant-violation' core outcome is unhandled in run.ts. At packages/dorfl/src/run.ts:762-783 only 'gate-failed', 'review-blocked', and 'rebase-conflict' route to needs-attention; everything else falls through to state:'done' / status:'claimed-done'. So when the one-slug-one-folder guard FAILS LOUD (integration-core.ts returns 'invariant-violation', integrating nothing), the autonomous run daemon MISREPORTS it as a completed job with no prUrl — the opposite of fail-loud, on the least-supervised caller. FIX: route 'invariant-violation' to needs-attention in run.ts (same arm as 'rebase-conflict'), with a clear reason, never claimed-done. complete.ts:531 already handles it correctly; mirror that. Add a run.ts test asserting an 'invariant-violation' core outcome records state:'needs-attention' (not claimed-done). Keep the rest of the slice's good work intact; re-run the full gate (pnpm -r build && pnpm -r test && pnpm -r format:check).
