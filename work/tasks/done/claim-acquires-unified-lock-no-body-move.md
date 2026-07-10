---
title: CLAIM additionally acquires the unified lock (interim dual-write; body still moves to in-progress/)
slug: claim-acquires-unified-lock-no-body-move
spec: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [unified-item-lock-module-from-tracer]
covers: [1, 3, 15, 16]
---

> **RE-SCOPED 2026-06-18 to Option A (interim dual-write).** The original mandate
> ("claim acquires the lock INSTEAD OF the body move; claim writes NOTHING to
> `main`; `--resume` reads no in-progress body") could not be built green in
> ISOLATION: removing the `work/in-progress/<slug>.md`-on-`main` artifact breaks
> `complete`/`start`/`needs-attention`/`do`/`run` and ~25 test files that still
> consume it by folder, yet the slices that retarget THOSE consumers (#6/#7/#9) are
> declared `blockedBy` this one (an inverted, unbuildable order). The decided fix
> (conductor + human, driven via `drive-backlog`) is **Option A**: this slice makes
> claim ADDITIONALLY acquire the per-item lock while KEEPING today's
> `git mv backlog→in-progress` (and `claimCommit`) exactly as-is, so every existing
> folder consumer and test stays green. The "stop moving the body / no `main` write /
> resume-reads-`backlog/`" cut-over is DEFERRED to the capstone
> `retire-transient-folders-and-drop-rebase` (#9), which retargets the consumers and
> retires the transient folders atomically once they are all lock-aware. The original
> slug is kept for traceability even though the body now does still move.

## What to build

Make the CLAIM path ALSO acquire the item's unified per-item lock
(`action: implement`) at claim time, **in addition to** today's shared-`main` CAS
`git mv backlog→in-progress`. This is the additive, back-compatible half of the
claim retarget: it introduces the lock as the eventual exclusion primitive and the
held-slug subtraction in the selection readers, WITHOUT yet removing the
`in-progress/`-on-`main` artifact that the rest of the runner still consumes.

Concretely, after this slice:

- `performClaim` keeps its existing behaviour (the `git mv backlog→in-progress`
  micro-commit via `applyTransition`, returning `claimCommit`) UNCHANGED, and
  ADDITIONALLY acquires the per-item lock (`action: implement`) for the claimed
  item. If the lock acquire is `lost` (someone already holds it for the SAME item),
  claim loses definitively (no retry budget) and does NOT perform the body move
  either, the two exclusion mechanisms agree on the same winner.
- The selection readers that enumerate the `backlog/` pool (`scan.ts`,
  `select-priority.ts`, `mirror-pool-scan.ts`, and the claimability check in
  `claim-cas.ts`) SUBTRACT lock-held slugs (enumerate held locks via the lock
  module's `list`, exclude them). With the body still moving to `in-progress/` this
  subtraction is REDUNDANT-but-harmless today (the moved body already leaves the
  pool); it is wired now so that when #9 stops the body move, the predicate
  "in `backlog/` on `main` AND no lock held" is already in force.

The "claim writes NOTHING to `main` / body stays in `backlog/` / `--resume` reads
`backlog/`" end state is OUT OF SCOPE here and owned by #9 (see the RE-SCOPED banner).

NOTE on the pool name: today the eligible pool IS `backlog/` (the position gate's
STEP-A landed; `pre-backlog/` is staging). The deferred STEP-B rename will make the
pool `todo/`; when it lands, only the folder NOUN read as "the pool" changes, this
predicate's shape is unaffected. Build against `backlog/` now.

## Acceptance criteria

- [ ] `performClaim` ADDITIONALLY acquires the per-item lock (`action: implement`)
      at claim time; today's `git mv backlog→in-progress` micro-commit and the
      returned `claimCommit` are KEPT unchanged (interim dual-write).
- [ ] A lock `lost` (the item is already locked for the SAME item) makes claim lose
      definitively (no retry budget), and NO body move is performed in that case;
      the lock exclusion and the existing CAS agree on the winner.
- [ ] The selection readers (`scan.ts`, `select-priority.ts`, `mirror-pool-scan.ts`,
      claimability in `claim-cas.ts`) SUBTRACT lock-held slugs from the enumerated
      `backlog/` pool (redundant-but-harmless while the body still moves; in force
      for #9).
- [ ] Race tests on a `--bare file://` arbiter: N claims of DIFFERENT items → ZERO
      `push rejected ... main is contended` for the LOCK acquire (the lock never
      falsely contends); two claims of the SAME item → exactly one wins, the other is
      definitively `lost`.
- [ ] Every EXISTING claim/complete/start/needs-attention/do/run test still passes
      (the body still moves to `in-progress/`; `claimCommit` is still on `main`); this
      slice does NOT remove the `in-progress/`-on-`main` artifact.
- [ ] Tests use throwaway repos + a `--bare file://` arbiter; nothing writes outside
      its own temp fixtures.

## Blocked by

- `unified-item-lock-module-from-tracer` (the lock API claim acquires through).

## Prompt

> Make the CLAIM path ALSO acquire the unified per-item lock from
> `unified-item-lock-module-from-tracer`, IN ADDITION to today's behaviour. Read
> `packages/dorfl/src/claim-cas.ts` (`performClaim`) first: it `git mv`s the
> body `backlog→in-progress` via `applyTransition` and returns `claimCommit`. KEEP
> that exactly as-is. ADD: after (or as part of) a successful claim, acquire the
> per-item lock (`action: implement`) via the lock module (`acquireItemLock`,
> keyed through `lockEntryFor`). If the lock acquire returns `lost`, claim loses
> definitively (no retry) and performs NO body move for that item. SPEC
> `work/spec/ledger-status-per-item-lock-refs.md` (US #1, #3, #15, #16); ADR
> `docs/adr/ledger-status-on-per-item-lock-refs.md`.
>
> READ the RE-SCOPED banner at the top of this slice: this is the INTERIM DUAL-WRITE
> half only. Do NOT remove the `in-progress/`-on-`main` artifact, do NOT make claim
> stop writing `main`, do NOT change `--resume` to read `backlog/`. Those break
> `complete`/`start`/`needs-attention`/`do`/`run` + ~25 tests whose retargets are the
> capstone slice #9 `retire-transient-folders-and-drop-rebase`; they are explicitly
> OUT OF SCOPE here. The acceptance gate must end GREEN with the body still moving to
> `in-progress/`.
>
> Also wire the held-slug SUBTRACTION into the pool readers (`scan.ts`,
> `select-priority.ts`, `mirror-pool-scan.ts`, the claimability check in
> `claim-cas.ts`): enumerate held locks via the lock module's `list` and exclude
> those slugs from the `backlog/` pool. With the body still moving this is
> redundant-but-harmless today; it is wired now so #9 can stop the body move without
> re-touching these readers. Pool vocabulary: the pool is `backlog/` (read the SPEC's
> VOCABULARY CORRECTION banner; `todo/` is the DEFERRED STEP-B rename, NOT this work).
> Do NOT introduce `todo/`.
>
> Test on a `--bare file://` arbiter (`test/helpers/gitRepo.ts`): high fan-out
> different-item claims = zero contention on the LOCK; same-item = exactly one winner;
> and prove the EXISTING claim/complete/start tests still pass (body still moves).
> "Done" = `pnpm -r build && pnpm -r test && pnpm format:check` green.
>
> NOTE: `humanOnly: true` is a DECIDED review-gate (driven via `drive-backlog`), not
> SPEC propagation. This is the load-bearing claim invariant; record non-obvious
> in-scope decisions per the slice template.

## Needs attention

acceptance gate failed (exit 1) on the rebased tip

## Requeue 2026-06-18

GATE RED on the build agent's OWN new tests (3 failures in test/claim-acquires-unified-lock.test.ts): a same-item race left the lock at [] and a distinct principal STOLE the winner's lock. ROOT CAUSE: the added reclaimOwnStaleLock() self-heal treats a lock-`lost` as possibly-our-own by comparing holder identity (resolveLockHolder = git user.name), then RELEASES + re-acquires. But two distinct racers on the same machine/user share a holder id (racerEnv sets GIT_AUTHOR_NAME, NOT user.name), so the LOSER releases the WINNER's still-valid lock. This breaks the core mutual-exclusion invariant and is OUT OF SCOPE for this slice. FIX: DELETE reclaimOwnStaleLock() and the lock-`lost` self-heal branch entirely. A lock-`lost` must be DEFINITIVE (exit 2, no retry, no body move), full stop, exactly as the slice's acceptance criteria state ('A lock lost ... makes claim lose definitively (no retry budget), and NO body move'). Orphaned-own-lock / vanished-own-lock recovery is slice 8 (release-lock-verb-and-gc-stuck-report) + the requeue path, NOT claim, and must never be holder-equality-based during a live race. KEEP everything else you built (the acquire-first ordering, releaseHeldLock on body-CAS loss/contend/error, the scan/select-priority/mirror-pool-scan lock-subtraction) - that part is correct. After removing the self-heal, the three failing tests should pass: a distinct principal that loses the lock does NOT steal it (lock stays ['slice-<slug>']), and the body still moves to in-progress/ for the winner only.
