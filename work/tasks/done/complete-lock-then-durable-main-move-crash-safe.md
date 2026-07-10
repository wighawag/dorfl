---
title: Crash-safe complete (hold lock, land durable main move, release)
slug: complete-lock-then-durable-main-move-crash-safe
spec: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [claim-acquires-unified-lock-no-body-move, needs-attention-as-stuck-lock-state]
covers: [9, 10]
---

> **RE-SCOPED 2026-06-18 to Option A (interim dual-write).** Under Option A claim
> still moves the body to `in-progress/` (the body-stays-in-`backlog/` cut-over is
> deferred to #9), so complete's SOURCE folder is still `in-progress/` here, NOT
> `backlog/`. This slice therefore KEEPS complete's existing durable `main` move
> (today's `in-progress → done`, or `spec → spec-sliced`, or the `→ dropped` terminal)
> and ADDS the cross-substrate ORDERING + recovery around it: hold the lock → land
> the durable `main` move FIRST → release the lock SECOND, with the `main` record
> authoritative over a stale lock. The change of complete's source to `backlog/`
> (once claim stops moving the body) is DEFERRED to #9; the ordering + recovery rule
> built here is substrate-agnostic and carries through unchanged. Where the criteria
> below say `backlog → done`, read it as "complete's durable move (interim:
> `in-progress → done`)".

## What to build

Make the COMPLETE path cross-substrate crash-safe. Completing an item is now:
hold the lock → land the DURABLE `main` move (complete's existing durable move,
interim `in-progress → done` atomic with the code; or `spec → spec-sliced`; or
`→ dropped`) → release the lock. ORDER MATTERS: the `main` durable move lands FIRST
(it is the authoritative referenceable record), the lock release SECOND. A crash
BETWEEN them leaves a `done`-on-`main` item with a still-held lock; recovery treats
the `main` durable record as AUTHORITATIVE and clears the stale lock.

The reconciliation rule: if `main` shows the item terminal (`done`/`dropped`/
`spec-sliced`) but a lock entry lingers, the lock is stale → clear it. The reverse
(lock held, item not terminal on `main`) is the NORMAL in-flight state. And
`done` + `stuck` may co-exist (a rebase-conflict bounce can mark a just-completed
item stuck), so recovery must NOT treat that combination as corruption.

NOTE on the terminal name: the durable "won't-proceed" terminal is `dropped/`
(it generalised `out-of-scope/`; the position gate's STEP-A landed it). Build
against `dropped/`.

## Acceptance criteria

- [ ] Complete orders the steps main-move-FIRST, release-SECOND; complete's durable
      move (interim `in-progress → done`) stays atomic with the code (and
      `spec → spec-sliced` / `→ dropped` with their artifacts). The unified-lock RELEASE
      is added after the move; complete's existing durable move is otherwise unchanged
      (the source-folder change to `backlog/` is #9's).
- [ ] Every EXISTING complete test still passes (complete still sources its durable
      move from `in-progress/` under Option A); this slice ADDS the lock
      ordering/release + recovery, it does not change complete's source folder.
- [ ] Recovery: a `done`/`dropped`/`spec-sliced` item on `main` with a lingering lock
      → the `main` record wins, the stale lock is cleared.
- [ ] `done` + a `stuck` lock co-exist without being treated as corruption (the
      stuck lock wins the human's attention; the `main` record wins dependency
      resolution).
- [ ] A crash simulated between the `main` move and the release converges on recovery
      (no lost durable record, no stranded lock after recovery runs).
- [ ] Tests use throwaway repos + a `--bare file://` arbiter; nothing writes outside
      its own temp fixtures.

## Blocked by

- `claim-acquires-unified-lock-no-body-move` (the implement hold completing).
- `needs-attention-as-stuck-lock-state` (the `done`+`stuck` co-existence path).

## Prompt

> Make COMPLETE cross-substrate crash-safe. Read the existing complete path
> (`packages/dorfl/src/complete*.ts` and the `ledger-write.ts` durable
> transitions), today the done-move and any lock cleanup are entangled on `main`.
> READ the RE-SCOPED banner: under Option A complete still sources its durable move
> from `in-progress/` (the `backlog/`-source cut-over is #9). New order: hold lock →
> land the DURABLE `main` move FIRST (complete's existing move, interim
> `in-progress → done`, atomic with the code; or `spec → spec-sliced`; or `→ dropped`)
> → release the unified lock SECOND. Do NOT change complete's source folder to
> `backlog/` here. SPEC `work/spec/ledger-status-per-item-lock-refs.md` (US #9, #10); ADR
> `docs/adr/ledger-status-on-per-item-lock-refs.md`; the trail's Amendment 6
> (cross-substrate crash-safety).
>
> The recovery rule is the heart: the `main` durable record is AUTHORITATIVE over a
> stale lock, if `main` shows the item terminal but a lock lingers, clear the lock;
> the reverse (held lock, not terminal) is normal in-flight. And `done` + `stuck` may
> co-exist (a rebase-conflict bounce of a just-completed item), recovery must allow
> it, not flag corruption. Generalise the landed advancing-lock crash-safety
> (`advancing-lock-release-crash-safe` in `work/done/`) to this. Build against the
> `dropped/` terminal (NOT `out-of-scope/`; see the SPEC's VOCABULARY CORRECTION).
>
> Simulate a crash between the main move and the release; assert recovery converges.
> Test on a `--bare file://` arbiter (`test/helpers/gitRepo.ts`). "Done" =
> `pnpm -r build && pnpm -r test && pnpm format:check` green.
>
> NOTE: `humanOnly: true` is a DECIDED review-gate (driven via `drive-backlog`), not
> SPEC propagation. Record non-obvious in-scope decisions per the slice template.
