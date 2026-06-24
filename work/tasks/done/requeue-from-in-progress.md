---
title: requeue recovers a slice from in-progress/ too (not only needs-attention/) — arbiter-resolved current folder -> backlog/ via the same tree-less CAS, keep+continue default / --reset discards
slug: requeue-from-in-progress
prd: ledger-integrity
blockedBy: []
covers: [4]
---

## What to build

Let `requeue` recover a slice STUCK in `in-progress/`, not only one in `needs-attention/` (defect 2, story 4).

Today `requeue` is hardcoded to the `needs-attention/ -> backlog/` transition (it says so in the CLI help and resolves source as needs-attention). A slice stranded in `in-progress/` (claimed, never surfaced) cannot be requeued — the conductor's standard recovery verb ERRORS with a bare "not found", and the item is stranded until a human hand-moves it. There are three ways a slice gets stuck in `in-progress/` rather than `needs-attention/`: (a) a push/integration failure that errors out BEFORE the surface routine; (b) an interrupted/killed run that never surfaced; (c) a requeue note appended to the in-progress file body while the file stayed in `in-progress/`. The asymmetry is the bug: `needs-attention/` is recoverable, the equally- (arguably more-) stuck `in-progress/` is not.

Make `requeue` resolve the slug's ACTUAL current folder on the arbiter (fetch-first, arbiter-is-truth) and move it to `backlog/` via the SAME tree-less CAS the needs-attention requeue uses (#89) — accepting BOTH `in-progress/` and `needs-attention/` as legitimate sources. Preserve the existing semantics: keep+continue is the default (leave the `work/<slug>` branch untouched so the next claim continues from its tip), `--reset` discards (delete the remote work branch first, then move), `-m/--message` appends a dated handoff note. AT MINIMUM, even if a deeper unification is deferred, a `requeue` on an in-progress slug MUST give a CLEAR, actionable message — never a bare "not found".

This reuses the existing requeue machinery and the tree-less CAS; it does not introduce a new transition model. File-orthogonal to the integration-core slices (it lives in the `requeue` CLI action + the requeue transition), so it can run in parallel with them.

## Acceptance criteria

- [ ] `requeue <slug>` on a slice currently in `in-progress/` on the arbiter MOVES it to `backlog/` via the same tree-less CAS used for the needs-attention requeue — resolving the slug's actual current folder from the arbiter, not the local tree.
- [ ] Both `in-progress/` and `needs-attention/` are accepted as requeue sources; the existing needs-attention -> backlog behaviour is UNCHANGED (no regression).
- [ ] keep+continue remains the DEFAULT (work branch untouched; next claim continues from its tip rebased onto fresh main); `--reset` still discards (delete remote work branch first, then move); `-m/--message` still appends a dated handoff note. These apply identically to the in-progress source.
- [ ] If the unified move is genuinely out of scope for some path, a `requeue` on an in-progress slug STILL gives a CLEAR, actionable message (never a bare "not found"). (This is the floor; prefer the full move.)
- [ ] The CLI help text no longer claims requeue is needs-attention-only.
- [ ] Tests REPRODUCE a slice stuck in `in-progress/` in a throwaway-git fixture and assert `requeue` moves it to `backlog/` (keep+continue leaves the branch; `--reset` deletes it) via the tree-less CAS — never staging/committing the cwd working tree; plus the unchanged needs-attention path still passes.
- [ ] Tests cover the new behaviour in the repo's existing vitest style; no shared/global location touched outside temp fixtures.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. File-orthogonal to the integration-core slices (touches the `requeue` CLI action + the requeue transition, not the done-move).

## Prompt

> Make dorfl's `requeue` recover a slice stuck in `in-progress/` too, not only `needs-attention/` (story 4 of the ledger-integrity PRD, `work/prd-sliced/ledger-integrity.md`, possibly in `work/slicing/` until this slicing lands; defect 2). Today `requeue` is hardcoded to `needs-attention/ -> backlog/` and a slice stranded in `in-progress/` (un-surfaced abort, killed run, or an in-place requeue note) errors with a bare "not found".
>
> FIRST, check this slice against current reality (launch snapshot — WORK-CONTRACT.md "Drift is a needs-attention signal"). Confirm `packages/dorfl/src/cli.ts`'s `requeue` action + `packages/dorfl/src/needs-attention.ts`'s return-to-backlog transition still resolve source as needs-attention-only, and that `ledgerWrite.applyTransition` (`packages/dorfl/src/ledger-write.ts`, #89) is still the tree-less CAS. If a dependency landed differently, reconcile or route to `needs-attention/`.
>
> DOMAIN: `work/` IS the ledger — STATUS is the FOLDER; transitions are tree-less compare-and-swap pushes to the arbiter ref (like claim), NEVER staging/committing the cwd working tree (so a requeue in a shared checkout can't sweep a concurrent writer's uncommitted files). The arbiter is the source of truth: resolve the slug's CURRENT folder from the arbiter, not the local tree. keep+continue is the default (branch untouched, next claim continues from its tip); `--reset` discards (delete remote work branch first, then move); `-m` appends a dated handoff note.
>
> BUILD: accept BOTH `in-progress/` and `needs-attention/` as requeue sources; resolve the actual current folder from the arbiter and move to `backlog/` via the SAME tree-less CAS; preserve keep+continue / `--reset` / `-m` for both sources; update the CLI help so it no longer says needs-attention-only. The FLOOR (if any path can't do the full move) is a clear actionable message, never a bare "not found".
>
> TEST (TDD, vitest, house style — throwaway git repos, temp dirs, real shared dirs untouched): reproduce a slice stuck in `in-progress/` and assert `requeue` moves it to `backlog/` via the tree-less CAS (keep+continue leaves the branch, `--reset` deletes it), with the cwd working tree never staged/committed; assert the existing needs-attention path is unchanged.
>
> "Done" = `requeue` recovers from both `in-progress/` and `needs-attention/` via the shared tree-less CAS with keep/--reset/-m preserved, the help corrected, the reproduction + no-regression tests, and the gate green.
