---
title: review-gate non-blocking nits for 'slicing-acquires-unified-lock' (Gate 2 approve)
date: 2026-06-18
status: open
reviewOf: slicing-acquires-unified-lock
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'slicing-acquires-unified-lock' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the unified lock is acquired FIRST (before the marker CAS), and every later marker-race failure (lost/contended/thrown) compensates by releasing the just-taken lock. Is lock-before-marker the intended ordering (vs marker-first)?
  (The slice said 'on a successful acquire, ALSO acquire the lock' without pinning the order. The agent chose lock-first with a `releaseHeldLock()` compensator on all three marker-failure branches + the catch. This is correct and well-tested (the 'non-existent PRD' test proves no orphan), but it is a non-obvious, load-bearing ordering choice that was not recorded in a ## Decisions block. No Decisions block was written at all, despite the prompt explicitly requesting one.)
- Ratify: the SUCCESS-path unified-lock release lives in `performSlice` (slicing.ts) on `core.outcome === 'completed'`, NOT in `releaseSlicingLock`, because the completing `prd → prd-sliced` commit is owned by the integrate band. Is splitting the release across two files the intended shape?
  (This is a cross-component decision: the lock release is in two places (`runRelease` for abort/needs-attention/review-blocked; `performSlice` for completed/propose). It is correct (no double-release, releases are idempotent), but a future reader must know both surfaces exist to reason about lock lifetime. It belongs in a Decisions block. The comment also notes the propose-path 'hold-across-the-PR crash-safe ordering' is deferred to capstone #7 — worth the human confirming that interim looseness is acceptable.)
- Ratify: a unified-lock `lost` performs NO auto-steal of a possibly-orphaned lock (exit 2, definitive), consistent with claim and the ADR's no-heartbeat/no-auto-sweep recovery model (a human asserts a lock is dead via release-lock + gc --ledger). Confirm this refusal behaviour is the intended UX for slicing.
  (A new user-visible refusal: a slicer for an item whose lock is held (even by a crashed holder) loses with no retry and no self-heal, requiring a human to clear it. This matches the documented recovery model and the sibling claim slice, so it is almost certainly correct, but it is an in-scope refusal decision the agent made on its own and did not record.)
