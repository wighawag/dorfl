---
title: ledger-read.ts still calls work/slicing/ a PRD's "post-slice record" in one docstring — a leftover of the resting-state framing the lock-semantic already corrected everywhere else
date: 2026-06-07
status: open
---

## The signal

`autoslice-lock` (`work/backlog/autoslice-lock.md`) flagged a DRIFT to reconcile
when built: `src/ledger-read.ts` described `work/slicing/<slug>.md` as a PRD's
*"slicing record"* that exists *"once sliced"* — i.e. it read `slicing/` as a
RESTING post-slice state, which contradicts the lock-only semantic (the PRD returns
to `work/prd/` on release; sliced-ness is the PRD's `sliced:` marker, never
residence in `slicing/`).

Re-checking the CURRENT `main` (2026-06-07), that drift is **already ~90%
reconciled** — most of `ledger-read.ts` now says the right thing:

- `PrdExistence` docstring: *"a transient held lock, NOT a 'sliced' resting state
  — the lock returns the PRD to `work/prd/`; sliced-ness is the PRD's `sliced:`
  marker"* (lines ~60–62).
- `slicingFile` field: *"CURRENTLY being sliced (lock held), not 'has been
  sliced'"* (line ~78).
- `findPrdFileBySlug` docstring: *"in flight, not 'sliced'"* (line ~263).

## The one leftover

ONE stale phrase remains, contradicting the rest:

- `src/ledger-read.ts` ~line **185** (the `resolvePrdExistence` method docstring):
  > `work/prd/` (the PRD source) and/or `work/slicing/` (**its post-slice record**).

"its post-slice record" is the old resting-state framing — it should read something
like "(a transient held lock while the PRD is being sliced)", matching the
`PrdExistence` / `slicingFile` / `findPrdFileBySlug` wording already corrected
above.

## Disposition

- **Not blocking.** It is a single docstring phrase; the code behaviour is correct
  and the field semantics are documented correctly two lines up.
- **Cheap mop-up FOR the `autoslice-lock` implementer.** That slice already owns
  the acceptance criterion "the `ledger-read` 'slicing record' drift is
  reconciled," so this leftover is in-scope when it is built — it is now just a
  one-line fix, not the larger reconciliation the slice originally anticipated (most
  of it already landed). Recorded here so the near-done state is visible and the
  last phrase is not missed.

(Captured 2026-06-07 during the auto-slice plan drift-review pass.)
