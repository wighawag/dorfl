---
title: Lock-entry two-axis state machine + invariants
slug: lock-entry-state-machine-and-invariants
prd: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [unified-item-lock-module-from-tracer]
covers: [4, 10]
---

## What to build

The two-axis lock entry's full STATE MACHINE on top of the production lock module:
the legal CAS transitions and the invariants that keep an item's transient state
coherent. Each transition is a CAS on the per-item lock ref so two contenders
serialise and exactly one wins. The cells of the machine are the (`action`, `state`)
pairs: `implement|slice|advance` × `active|stuck`.

Transitions to implement (each a single CAS on the lock ref):

1. acquire `(absent) → [action, active]`
2. mark-stuck `[action, active] → [action, stuck] + reason`
3. resume `[action, stuck] → [action, active]`
4. requeue `[action, stuck] → (absent)` (return to the pool; body never moved)
5. complete `[action, active] → (durable main move) → (absent)` (the main move is
   owned by the complete slice; here, just the lock side: release after)
6. release `[action, active] → (absent)` (abort/no-op, no main move)

Invariants enforced + tested: AT MOST ONE entry per item (the issue-3 exclusion;
acquire on a present entry is `lost`); `reason` PRESENT iff `state: stuck` (active
never carries a reason); `done` + `state: stuck` may legitimately CO-EXIST (a
rebase-conflict bounce can mark a just-completed item stuck), so the lock-ref state
and a `main` durable record can disagree without corruption.

## Acceptance criteria

- [ ] All six transitions implemented as CAS operations on the lock ref, each
      returning a definitive winner/loser outcome (no retry loop).
- [ ] Invariant: at most one entry per item, acquire on a held item is `lost`;
      a second action (e.g. advance) on an implement-held item also loses the SAME CAS.
- [ ] Invariant: `reason` is present iff `state: stuck`; an `active` entry never
      carries a stuck reason.
- [ ] `done` (a `main` durable record) + a `stuck` lock entry can co-exist; tests
      assert the two are allowed to disagree (the stuck lock wins the human's
      attention; the `main` record wins dependency resolution).
- [ ] Tests drive every legal transition and reject the illegal ones, on a
      `--bare file://` arbiter; nothing writes outside its own temp fixtures.

## Blocked by

- `unified-item-lock-module-from-tracer` (the production lock module this state
  machine is built on).

## Prompt

> FIRST, check this slice against current reality (it is a launch snapshot and may
> have DRIFTED): does the production lock module from
> `unified-item-lock-module-from-tracer` still expose the API this assumes, and does
> the design trail's state machine still match? If a dependency landed differently,
> route the slice to `needs-attention/` with the discrepancy rather than building on
> a stale premise (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> Build the two-axis lock-entry STATE MACHINE on top of the production lock module
> from `unified-item-lock-module-from-tracer`. The full machine + invariants are
> specified in the design trail
> `work/ideas/ledger-lock-evolution-per-item-ref-vs-rebase-until-real-conflict.md`
> under "### The C8 lock-entry STATE MACHINE (the two-axis record, in full)", read
> that section; it lists the six transitions and the invariants verbatim. PRD:
> `work/prd/ledger-status-per-item-lock-refs.md`; ADR:
> `docs/adr/ledger-status-on-per-item-lock-refs.md`.
>
> SCOPE: the LOCK side of the machine only, acquire / mark-stuck / resume / requeue /
> release as CAS transitions, plus the complete transition's lock half (release after
> a durable main move; the main move itself is owned by
> `complete-lock-then-durable-main-move-crash-safe`). Enforce and TEST the invariants:
> at most one entry per item (acquire on a present entry is `lost`, including a
> DIFFERENT action on the same item, that is the issue-3 mutual exclusion, atomic);
> `reason` iff `stuck`; and the load-bearing one, `done` on `main` and a `stuck` lock
> may co-exist (Amendment 2 / Amendment 6 in the trail). Do NOT add a liveness
> heartbeat or auto-sweep (deliberately absent; a human asserts a lock is dead).
>
> Test at the `--bare file://` arbiter seam (`test/helpers/gitRepo.ts`); drive every
> legal transition and assert the illegal ones are rejected. "Done" = the state
> machine + invariants hold and `pnpm -r build && pnpm -r test && pnpm format:check`
> is green.
>
> NOTE: `humanOnly: true` is a DECIDED review-gate choice (driven via `drive-backlog`),
> NOT PRD propagation. Record non-obvious in-scope decisions per the slice template.
