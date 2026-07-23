---
title: 'Cut-over 9a — claim stops moving the body; complete/integration source the done-move from backlog/'
slug: cutover-claim-body-stays-and-complete-sources-from-backlog
spec: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [claim-acquires-unified-lock-no-body-move, complete-lock-then-durable-main-move-crash-safe, release-lock-verb-and-gc-stuck-report]
covers: [1, 15, 16]
---

> **This is sub-slice 9a of the capstone re-slice (decided conductor + human, 2026-06-18).**
> The original `retire-transient-folders-and-drop-rebase` was too large to land green
> in one pass (the cut-over touches ~91 of 170 test files) and was re-sliced into
> 9a/9b/9c/9d, one consumer-family per slice. See
> `work/observations/retire-transient-folders-capstone-larger-than-one-green-pass.md`
> and the retired original in `work/dropped/retire-transient-folders-and-drop-rebase.md`.

## What to build

Finish the CLAIM cut-over begun by `claim-acquires-unified-lock-no-body-move` (which
landed the interim DUAL-WRITE: claim acquires the lock AND still `git mv`s
`backlog→in-progress`). This slice removes the body move so claim writes NOTHING to
`main`, and retargets the build/complete SOURCE axis that consumed the
`in-progress/` body onto `backlog/` + the lock ref.

After this slice:

- CLAIM acquires the per-item lock (`action: implement`) and does NOT move the body;
  the body stays at `work/backlog/<slug>.md`. A protected-`main` claim succeeds
  (claim writes nothing to `main`). (US #1, #15, #16 fully delivered.)
- COMPLETE / the integration core source the durable `→ done` move from `backlog/`
  (not `in-progress/`); the `→ done` / `→ dropped` / `→ spec-sliced` moves stay atomic
  with the code, and the hold → main-move-FIRST → release-SECOND ordering + recovery
  from `complete-lock-then-durable-main-move-crash-safe` is unchanged in shape, only
  the SOURCE folder changes.
- `start` / `--resume` / `do` / `run` read held-ness from the lock ref (a claimed
  item now rests in `backlog/` on `main`, so a folder-only "is it claimed?" check
  would mis-read it as unclaimed); `readSliceOnArbiter` / the ledger read path read
  the body from `backlog/`.
- `in-progress` STAYS in the status folder sets for now (its removal + the
  slicing/advancing markers + the folder-set trim is 9c), so the diff here is bounded
  to the claim-body + complete-source axis. `needs-attention/` is untouched here (its
  retarget is 9b).

> SCOPE FENCE: do NOT touch the `needs-attention/` folder/recovery surface (9b), do
> NOT remove the `slicing/`/`advancing/` markers or trim the folder sets (9c), do NOT
> delete `drop-bookkeeping-rebase` (9d). Keep `in-progress` in `LEDGER_STATUS_FOLDERS`
> / `WORK_FOLDERS` so the bounce/needs-attention paths that still source from
> `in-progress/` keep working until 9b/9c.

## Acceptance criteria

- [ ] Claim writes NOTHING to `main` (no `git mv backlog→in-progress`); a
      protected-`main` claim succeeds; the body stays at `work/backlog/<slug>.md`.
- [ ] `complete` / the integration core source the durable `→ done` (and
      `→ dropped` / `→ spec-sliced`) move from `backlog/`, atomic with the code; the
      hold → main-move → release ordering + crash recovery are preserved.
- [ ] `start` / `--resume` / `do` / `run` determine claimed/held-ness from the lock
      ref (not an `in-progress/` body); the item rests in `backlog/` while held.
- [ ] `readSliceOnArbiter` / the ledger read path read the body from `backlog/`.
- [ ] Every existing claim/complete/start/do/run test passes (updated to the
      body-stays-in-`backlog/` reality); `in-progress` remains in the folder sets
      (removed in 9c); `needs-attention/` is untouched (9b).
- [ ] Tests use throwaway repos + a `--bare file://` arbiter; nothing writes outside
      its own temp fixtures.

## Blocked by

- `claim-acquires-unified-lock-no-body-move` (the interim dual-write this finishes).
- `complete-lock-then-durable-main-move-crash-safe` (the ordering/recovery this
  re-sources onto `backlog/`).
- `release-lock-verb-and-gc-stuck-report` (the full recovery surface exists).

## Prompt

> Finish the CLAIM cut-over. `claim-acquires-unified-lock-no-body-move` landed the
> interim dual-write (claim acquires the lock AND still `git mv`s
> `backlog→in-progress`); this slice REMOVES the body move so claim writes nothing to
> `main`, and retargets the consumers that read the `in-progress/` body onto
> `backlog/` + the lock. Read `claim-cas.ts` (`performClaim`), `complete.ts` +
> `integration-core.ts` (the done-move SOURCE axis + the `source` enum threaded
> through), `start.ts` (the folder-based dispatch), `ledger-read.ts`
> (`readSliceOnArbiter`), `do.ts`/`run.ts` (onboard). SPEC
> `work/spec/ledger-status-per-item-lock-refs.md` (US #1, #15, #16); ADR
> `docs/adr/ledger-status-on-per-item-lock-refs.md`.
>
> Remove claim's `git mv backlog→in-progress` (claim now only acquires the lock; body
> stays in `backlog/`). Retarget `complete`/`integration-core` to source the durable
> `→ done`/`→ dropped`/`→ spec-sliced` move from `backlog/` (NOT `in-progress/`),
> keeping the hold → main-move-FIRST → release-SECOND ordering + recovery unchanged in
> shape. Make `start`/`--resume`/`do`/`run` read held-ness from the lock ref (a
> claimed item rests in `backlog/`, so folder-only dispatch would re-claim it); read
> the body from `backlog/`.
>
> SCOPE FENCE (keep the diff bounded so it lands GREEN in one pass): KEEP `in-progress`
> in `LEDGER_STATUS_FOLDERS` (`ledger-lint.ts`) + `WORK_FOLDERS` (`ledger-write.ts`)
> — its removal is 9c. Do NOT touch `needs-attention/` (9b owns its retarget; the
> bounce path may still source from `in-progress/`/`needs-attention/` here). Do NOT
> remove the `slicing/`/`advancing/` markers (9c) or delete `drop-bookkeeping-rebase`
> (9d). Pool vocabulary: the pool is `backlog/` (the `todo/` rename is the deferred
> STEP-B SPEC; do NOT introduce `todo/`).
>
> Update the claim/complete/start/do/run consumer tests to the body-stays-in-`backlog/`
> reality. NEW git-`file://`-CAS race test files must be registered in the
> `RACE_SENSITIVE` list in `vitest.config.ts` (the house pattern — see the existing
> claim/slicing/advancing race files there) so they run in the sequential project and
> do not flake under full-suite parallel load. "Done" =
> `pnpm -r build && pnpm -r test && pnpm format:check` green.
>
> NOTE: `humanOnly: true` is a DECIDED review-gate (driven via `drive-backlog`), not
> SPEC propagation. Record non-obvious in-scope decisions per the slice template.
