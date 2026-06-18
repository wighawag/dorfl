---
title: needs-attention becomes the stuck lock state (read by status/scan)
slug: needs-attention-as-stuck-lock-state
prd: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [lock-entry-state-machine-and-invariants, claim-acquires-unified-lock-no-body-move]
covers: [5, 8]
---

## What to build

Make `needs-attention` a STATE of the per-item lock rather than a `main` folder. A
bounce (red gate, agent failure, conflict, ambiguity) MARKS the held lock
`state: stuck` + reason via a CAS amend, instead of `git mv in-progress→needs-attention`
on `main`. The recoverable WORK stays on the kept `work/<slug>` branch (unchanged);
the item's body stays in `backlog/` (it never moved on claim). Resolving a stuck
item is a lock amend (`resume` back to active) or a `requeue` (release the lock; the
item is already resting in the pool), NOT a folder bounce.

The in-flight view moves to the lock ref: `agent-runner status` / `scan` READ the
lock refs to list held (in-progress) and stuck (needs-attention) items with their
reasons. Eligibility/selection stay OFFLINE on `main` (the pool is still read from
`backlog/`); only the operational "what's in flight" view consults the lock ref.

## Acceptance criteria

- [ ] A bounce marks the held lock `state: stuck` + reason (a CAS amend), with NO
      `git mv` to a `work/needs-attention/` folder on `main`.
- [ ] `resume` (stuck → active) and `requeue` (stuck → release, item already in the
      pool) replace the `needs-attention → in-progress` / `needs-attention → backlog`
      folder moves.
- [ ] `agent-runner status` / `scan` read the lock refs and surface held (in-progress)
      and stuck (needs-attention) items + reasons; eligibility/selection still read
      the pool offline from `backlog/` on `main`.
- [ ] A `done` item can carry a `stuck` lock (rebase-conflict bounce of a just-
      completed item) without corruption (consistent with the state-machine invariant).
- [ ] Tests use throwaway repos + a `--bare file://` arbiter; nothing writes outside
      its own temp fixtures.

## Blocked by

- `lock-entry-state-machine-and-invariants` (the mark-stuck/resume/requeue transitions).
- `claim-acquires-unified-lock-no-body-move` (the implement hold a bounce marks stuck).

## Prompt

> FIRST, check this slice against current reality (it is a launch snapshot and may
> have DRIFTED): do the lock state machine + the claim retarget it depends on still
> match what landed, and is the in-flight `status`/`scan` read path as assumed? If a
> dependency landed differently, route the slice to `needs-attention/` with the
> discrepancy rather than building on a stale premise (WORK-CONTRACT.md "Drift is a
> needs-attention signal").
>
> Turn `needs-attention` from a `main` folder move into the `stuck` STATE of the
> per-item lock. Today a stuck claimed item is `git mv`'d
> `work/in-progress/<slug>.md → work/needs-attention/<slug>.md` with the reason in the
> body (`packages/agent-runner/src/needs-attention.ts` + the `ledger-write.ts`
> transitions), read those. New behaviour: mark the HELD lock `state: stuck` + reason
> via a CAS amend (the state machine from `lock-entry-state-machine-and-invariants`);
> no folder move. PRD `work/prd/ledger-status-per-item-lock-refs.md` (US #5, #8); ADR
> `docs/adr/ledger-status-on-per-item-lock-refs.md`.
>
> The recoverable work stays on the kept `work/<slug>` branch; the body stays in
> `backlog/` (it never moved on claim, per `claim-acquires-unified-lock-no-body-move`).
> Resolve = `resume` (stuck→active) or `requeue` (release; the item is already in the
> pool), NOT a folder bounce. Retarget the in-flight VIEW: `agent-runner status` /
> `scan` (`status.ts`, `scan.ts`) read the lock refs to list held + stuck items and
> reasons; keep eligibility/selection OFFLINE on `main` (pool still `backlog/`). Handle
> the `done`+`stuck` co-existence the state machine allows.
>
> Test on a `--bare file://` arbiter (`test/helpers/gitRepo.ts`). "Done" =
> `pnpm -r build && pnpm -r test && pnpm format:check` green.
>
> NOTE: `humanOnly: true` is a DECIDED review-gate (driven via `drive-backlog`), not
> PRD propagation. Record non-obvious in-scope decisions per the slice template.
