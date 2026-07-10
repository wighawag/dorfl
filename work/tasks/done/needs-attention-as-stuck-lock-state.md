---
title: needs-attention ALSO marks the stuck lock state, read by status/scan (interim dual-write)
slug: needs-attention-as-stuck-lock-state
spec: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [lock-entry-state-machine-and-invariants, claim-acquires-unified-lock-no-body-move]
covers: [5, 8]
---

> **RE-SCOPED 2026-06-18 to Option A (interim dual-write).** Consistent with the
> claim/slicing/advancing re-scopes: under Option A claim still moves the body to
> `in-progress/` and the `needs-attention/` folder is still consumed by the legacy
> bounce path + tests until the capstone #9 retargets them. So a bounce here
> ADDITIONALLY marks the held lock `state: stuck` + reason AND `status`/`scan`
> ADDITIONALLY read the lock refs, while the existing `git mv → needs-attention/`
> folder bounce is KEPT. Removing the legacy folder bounce (and switching
> resolution fully to `resume`/`requeue`) is DEFERRED to #9, where the consumers and
> tests are retargeted atomically. The lock's `stuck` state and the `done`+`stuck`
> co-existence (state-machine invariant) are exercised now so #9 can drop the legacy
> half cleanly.

## What to build

Make a bounce ALSO mark the held per-item lock `state: stuck` + reason (the lock's
mark-stuck transition), and make `dorfl status` / `scan` ALSO read the lock
refs to surface held (in-progress) and stuck (needs-attention) items + reasons,
**in addition to** today's `git mv in-progress→needs-attention` folder move and the
folder-based status view. This is the additive, back-compatible half: the lock
becomes the eventual in-flight substrate WITHOUT removing the `needs-attention/`
folder the legacy bounce path + ~tests still consume.

Concretely, after this slice:

- A bounce (red gate, agent failure, conflict, ambiguity) keeps its existing
  `git mv in-progress→needs-attention` on `main` UNCHANGED, and ADDITIONALLY marks
  the held lock `state: stuck` + reason via the CAS amend from
  `lock-entry-state-machine-and-invariants`.
- `dorfl status` / `scan` keep their folder-based view UNCHANGED, and
  ADDITIONALLY read the lock refs to list held + stuck items and reasons.
  Eligibility/selection stay OFFLINE on `main` (pool still `backlog/`).
- The `done` + `stuck` co-existence the state machine allows is exercised (a
  rebase-conflict bounce of a just-completed item).

The recoverable WORK stays on the kept `work/<slug>` branch (unchanged). Switching
resolution fully to lock `resume`/`requeue` and REMOVING the `needs-attention/`
folder bounce are OUT OF SCOPE here and owned by #9 (see the RE-SCOPED banner).

## Acceptance criteria

- [ ] A bounce ADDITIONALLY marks the held lock `state: stuck` + reason (a CAS
      amend); today's `git mv in-progress→needs-attention` folder move is KEPT
      unchanged (interim dual-write).
- [ ] `dorfl status` / `scan` ADDITIONALLY read the lock refs and surface held
      (in-progress) and stuck (needs-attention) items + reasons; eligibility/selection
      still read the pool offline from `backlog/` on `main`.
- [ ] A `done` item can carry a `stuck` lock (rebase-conflict bounce of a just-
      completed item) without corruption (consistent with the state-machine invariant).
- [ ] Every EXISTING needs-attention/bounce test still passes (the
      `needs-attention/` folder move still lands); this slice does NOT remove the
      folder bounce or the folder-based status view.
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
> Make a bounce ALSO mark the `stuck` STATE of the per-item lock, and `status`/`scan`
> ALSO read the lock refs, IN ADDITION to today's behaviour. Today a stuck claimed
> item is `git mv`'d `work/in-progress/<slug>.md → work/needs-attention/<slug>.md`
> with the reason in the body (`packages/dorfl/src/needs-attention.ts` + the
> `ledger-write.ts` transitions), read those. KEEP that folder move as-is. ADD: mark
> the HELD lock `state: stuck` + reason via the CAS amend (`markStuckItemLock` from
> `lock-entry-state-machine-and-invariants`). SPEC
> `work/spec/ledger-status-per-item-lock-refs.md` (US #5, #8); ADR
> `docs/adr/ledger-status-on-per-item-lock-refs.md`.
>
> READ the RE-SCOPED banner: this is the INTERIM DUAL-WRITE half. Do NOT remove the
> `git mv → needs-attention/` folder bounce and do NOT remove the folder-based
> status view; those break the legacy consumers + ~tests whose retargets are the
> capstone #9. Note claim still moves the body to `in-progress/` under Option A, so
> the bounce's SOURCE folder is still `in-progress/` here. Retarget the in-flight VIEW
> ADDITIVELY: `dorfl status` / `scan` (`status.ts`, `scan.ts`) ALSO read the
> lock refs to list held + stuck items and reasons; keep eligibility/selection OFFLINE
> on `main` (pool still `backlog/`). Handle the `done`+`stuck` co-existence the state
> machine allows. Prove the EXISTING needs-attention tests still pass (the folder move
> still lands).
>
> Test on a `--bare file://` arbiter (`test/helpers/gitRepo.ts`). "Done" =
> `pnpm -r build && pnpm -r test && pnpm format:check` green.
>
> NOTE: `humanOnly: true` is a DECIDED review-gate (driven via `drive-backlog`), not
> SPEC propagation. Record non-obvious in-scope decisions per the slice template.
