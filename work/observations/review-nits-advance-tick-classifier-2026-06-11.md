---
title: review-gate non-blocking nits for 'advance-tick-classifier' (Gate 2 approve)
date: 2026-06-11
status: open
slug: advance-tick-classifier
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'advance-tick-classifier' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the new `invariant-violation` TickRungKind: the slice enumerates exactly six rung kinds (build-slice/slice-prd/triage-observation/surface/apply/no-op) and asks only that invariant 1 be 'asserted here' without specifying the mechanism. The agent added a seventh, `invariant-violation`, returned for `needsAnswers` not-true + sidecar-present, and made `isAdvanceable` treat it as not-advanceable. Is widening the classifier's discriminated union (which later executor/driver slices will exhaustively switch on) the intended way to assert invariant 1, vs. throwing or collapsing to `no-op`?
  (advance-classify.ts adds `invariant-violation` to TickRungKind plus a `sidecar-without-needsAnswers` reason; it is a sound refuse-don't-mis-advance choice and has no downstream consumer yet (only index.ts re-exports it, verified), so it is purely additive today. Flagged for ratification because it is a load-bearing union the rest of the advance family will pattern-match on, and an un-listed addition to the slice's stated return set.)
- Coherence: invariant 1 is a biconditional (`needsAnswers:false ⟺ no active sidecar`), so BOTH directions can break. The agent classifies one break (needsAnswers-not-true + sidecar) as `invariant-violation`, but the other technical break (needsAnswers:true + NO sidecar) as `surface` (a normal transitional rung), not a violation. The PRD blesses the latter as transitional, so this is intended — but the asymmetry (one biconditional-break is a refusal, the other is a happy-path rung) is a real design call worth confirming.
  (classifyTick: `needsAnswers:true` + `sidecar === undefined` → `surface`; `!gated` + `sidecar !== undefined` → `invariant-violation`. The PRD's state machine explicitly treats needsAnswers+no-sidecar as the first-pass surface cell ('transitional — surfacing normally writes the sidecar atomically'), so the behaviour is correct; the finding is to make the deliberate asymmetry visible for ratification, not to block.)
- Dead enum member: the `reason` union declares `needsAnswers-without-sidecar` and documents it as 'kept for completeness ... only appears on the refusal path below', but `classifyTick` never produces it (the needsAnswers:true + no-sidecar path returns `surface` with no reason). Should this member be dropped to avoid implying a refusal path that does not exist?
  (advance-classify.ts TickClassification.reason includes `needsAnswers-without-sidecar`, which is unreachable in the current classifier. Harmless but slightly misleading for readers of the union; trivially removable.)
