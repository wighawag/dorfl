---
title: review-gate non-blocking nits for 'advance-sidecar-contract' (Gate 2 approve)
date: 2026-06-11
status: open
slug: advance-sidecar-contract
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'advance-sidecar-contract' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- RATIFY: an EMPTY sidecar (zero entries) is defined as `allAnswered === false`. The PRD/slice say allAnswered is 'derived from entries' but leave the zero-entry case undefined. The agent chose false, with the documented rationale that a no-question sidecar should not exist (it would be deleted on resolution) and that false keeps the 'pending ⇒ NO-OP' classifier honest. Is that the intended convention for the consumers (the tick/classifier) the later slices build?
  (sidecar.ts `allAnswered()` returns `model.entries.length > 0 && pendingEntries(model).length === 0`. A future classifier slice that treats `allAnswered === true` as 'apply/resolve' will never fire on an empty sidecar — correct given resolution deletes the sidecar — but it is an in-scope semantic choice the spec did not state.)
- RATIFY: the `observation` namespace is handled by the sidecar code itself, NOT by the resolver. The slice says to use `slug-namespace.ts` (`parseSlugArg`) as 'the single source of truth for the identity', but that resolver only knows `slice:`/`prd:`. The agent peels `observation:`/`obs:` BEFORE calling `parseSlugArg` and maps `obs:` → canonical `observation`. Is extending the identity space in the consumer (rather than the resolver) the intended seam, or should the `observation` namespace eventually move INTO `slug-namespace.ts` so there is one resolver of record?
  (sidecar.ts `resolveSidecarIdentity` does `if (prefix === 'observation' || prefix === 'obs') return observation` before delegating to `parseSlugArg`; `typeForNamespace` re-handles the same fallback. This is a small fork of the 'resolver is SoT' premise — defensible (the resolver's `prd`/`slice` split is reused untouched) but worth a human nod since later advance slices route `obs:` through the same identity.)
- RATIFY: `applyAtomic` introduces a new REFUSAL — when caller passes an explicit `mode` that disagrees with the model-derived resolution (a `mode:'resolve'` with pending entries, or `mode:'repause'` with all answered), it THROWS `ApplyAtomicError` rather than honouring the caller. The slice did not specify this guard. It is a good safety choice (refuses to publish a torn invariant), but it is a new error surface the lock/rung slices must code against.
  (sidecar-apply.ts checks `options.mode === 'resolve' && !resolved` / `=== 'repause' && resolved` and throws; the entries are the source of truth and `mode` is advisory-must-agree. Tests cover both throw cases.)
- RATIFY: the public export surface grew substantially via index.ts (12 new symbols incl. `newSidecar`, `resolveSidecarIdentity`, `isEntryAnswered`, `pendingEntries`, `ApplyMode`, etc.). `newSidecar` in particular is a first-pass constructor the slice did not enumerate (the slice listed `appendQuestions` but not a separate `newSidecar`). Is the full surface the intended public API for the consuming slices, or should some of these (e.g. `resolveSidecarIdentity`, `newSidecar`) stay internal until a consumer needs them?
  (index.ts now re-exports the whole sidecar + apply API. `newSidecar` is a thin wrapper over `appendQuestions` from an empty model — reasonable, but an addition beyond the slice's named operation list ('the first-pass constructor the surface-question rung uses').)
