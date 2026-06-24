---
title: Sweep the now-dead surface-commit ledger path (post lock-cutover housekeeping)
slug: sweep-dead-surface-commit-path-after-lock-cutover
blockedBy: []
covers: []
---

## What to build

A pure-deletion housekeeping chore: remove the now-dead mode-M "observable
surface-on-`main`" ledger machinery left vestigial by the
`ledger-status-per-item-lock-refs` cut-over (slices 9a-9d). After that cut-over a
bounce is a PURE lock amend (`bounceToStuckLock` -> `markStuckItemLock`), so
nothing produces a `git mv -> needs-attention/` move-only ledger commit to
"surface" onto `main` anymore. The surface-publish path that existed to mirror
that move onto `main` is therefore dead code with no live caller (flagged by the
9c/9d review nits).

Remove, in `packages/dorfl/src/ledger-write.ts`:

- `publishSurfaceCommit` and its helper `readLedgerPlacement` (no live caller; the
  only mention is a doc-comment reference in `retry-backoff.ts`).
- the vestigial `WORK_FOLDERS = ['backlog','done']` const they alone consume.
- the `SurfaceOutcome` / `PublishSurfaceResult` types IF and ONLY IF they become
  unused after the consumer cleanup below.

The one ENTANGLEMENT to resolve (this is why it is a gate-verified slice, not a
blind delete): `ApplyNeedsAttentionTransitionResult` still carries a
`surface?: SurfaceOutcome | 'not-attempted'` field (+ `surfaceError?`), and
`do.ts` reads `routed.surface ?? 'not-attempted'`. Since the bounce no longer
surfaces anything to `main`, that field is now always `'not-attempted'` /
vestigial. Decide and apply the clean removal: drop the `surface`/`surfaceError`
fields from `ApplyNeedsAttentionTransitionResult` and remove the `do.ts`
reporting that consumes them (or, if a consumer genuinely still needs a
surface-outcome signal, document why and keep the minimal shape). Whatever is
chosen, NO dangling reference to the removed symbols may remain.

Behaviour must be UNCHANGED (this is dead code): the acceptance gate is the proof.

## Acceptance criteria

- [ ] `publishSurfaceCommit`, `readLedgerPlacement`, and the `WORK_FOLDERS` const
      they consume are deleted from `ledger-write.ts`; no dangling reference
      remains (including the `retry-backoff.ts` doc-comment mention, updated).
- [ ] The `surface` / `surfaceError` vestige on `ApplyNeedsAttentionTransitionResult`
      and its `do.ts` consumer are removed (or, if kept, justified in a `## Decisions`
      note); `SurfaceOutcome` / `PublishSurfaceResult` are removed if thereby unused.
- [ ] No behaviour change: `pnpm -r build && pnpm -r test && pnpm format:check` is
      green with the dead path gone (the gate IS the regression proof for a pure
      deletion).
- [ ] Tests use throwaway repos + a `--bare file://` arbiter where any are touched;
      nothing writes outside its own temp fixtures.

## Blocked by

- None. The cut-over (9a-9d) that made this code dead is already in `work/done/`.

## Prompt

> Pure-deletion housekeeping. The `ledger-status-per-item-lock-refs` cut-over
> (slices 9a-9d, all in `work/done/`) made a bounce a PURE lock amend
> (`bounceToStuckLock` -> `markStuckItemLock`), so the mode-M "observable
> surface-on-`main`" path no longer has anything to surface. Delete the dead code:
> `publishSurfaceCommit` + `readLedgerPlacement` + the `WORK_FOLDERS` const in
> `packages/dorfl/src/ledger-write.ts` (verify no live caller first:
> `readLedgerPlacement` is called only by `publishSurfaceCommit`; `publishSurfaceCommit`
> has no code caller, only a doc-comment mention in `retry-backoff.ts`). Resolve the
> ENTANGLEMENT: `ApplyNeedsAttentionTransitionResult.surface?: SurfaceOutcome |
> 'not-attempted'` (+ `surfaceError?`) is now vestigial (the bounce surfaces nothing)
> and `do.ts` reads `routed.surface ?? 'not-attempted'` \u2014 remove the field + its
> consumer (and then `SurfaceOutcome`/`PublishSurfaceResult` if unused), or justify
> keeping a minimal shape in a `## Decisions` note. NO dangling references.
>
> This is DEAD CODE: behaviour must not change, and the acceptance gate
> (`pnpm -r build && pnpm -r test && pnpm format:check`) is the regression proof. If
> you discover a symbol is actually still live (a real consumer beyond the vestigial
> ones named here), do NOT force the deletion \u2014 STOP and route to needs-attention
> with what you found (it would mean the cut-over left a live dependency this slice
> misjudged). Record any non-obvious in-scope decision per the slice template.
