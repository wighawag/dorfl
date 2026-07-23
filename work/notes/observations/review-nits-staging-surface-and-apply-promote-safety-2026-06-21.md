---
title: 'review-gate non-blocking nits for ''staging-surface-and-apply-promote-safety'' (Gate 2 approve)'
date: 2026-06-21
status: open
reviewOf: staging-surface-and-apply-promote-safety
needsAnswers: false
triaged: keep
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'staging-surface-and-apply-promote-safety' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Is F3a/F3b's `blockedBy: [f1]` strictly necessary, or only a merge-conflict hedge?
  (F3a primarily edits `apply-persist.ts` and an identity-keyed resolver; F3b edits the promote position-CAS path. Neither obviously reads the `state.backlog` pool-noun that F1 renames. Both slices justify the blocker as 'touches overlapping readers / config doc-comments; serialise to avoid merge conflicts', which is reasonable but conservative — if F1 turns out to land slowly, F3a/F3b could in principle proceed once the touched surfaces are confirmed disjoint. Not a correctness defect; flagged so the runner knows the dependency is a serialisation hedge, not a semantic prerequisite.)
- Do F2/F3 need to mirror anything into `work/protocol/` / `skills/setup/protocol/`?
  (F1 explicitly calls out the AGENTS.md mirroring rule for protocol-doc renames. F2 introduces a new config key (`surfaceStaging`) and F3b changes the lock discipline of `promote`; if any protocol/contract doc in `skills/setup/protocol/` documents the surface-pool composition or the per-item lock's coverage of promote, those slices should mirror too. Neither slice's acceptance criteria mention this. Likely a no-op (these are behavioural/config changes, not contract-doc changes), but worth a quick check during build.)

## Applied answers 2026-06-22

### q1: Finding 1 — F3a/F3b's `blockedBy: [f1]` is flagged as a serialisation hedge, not a semantic prerequisite. Should we (a) drop/relax the blocker now (promote a tiny slice to re-examine and remove it if surfaces are confirmed disjoint), (b) keep the observation as a note for the runner so dispatch can override if F1 stalls, or (c) delete it as not worth tracking?

KEEP — record as a runner hint that the `blockedBy: [f1]` is a serialisation hedge (touches overlapping readers / config doc-comments), not a semantic prerequisite; dispatch may override it if F1 stalls. Do not spend a slice re-examining it now. Disposition: keep.

disposition: keep

### q2: Finding 2 — should F2 (new `surfaceStaging` config key) and F3b (changed lock discipline of `promote`) mirror anything into `skills/setup/protocol/` and `work/protocol/`, and if so should that mirroring be promoted as its own slice, folded into the existing F2/F3b slices, or dropped as a no-op?

KEEP — do the quick grep during F2/F3b build; promote a follow-up only if a protocol doc is actually found to document the affected surface. Heads-up for the builder: the staging/pool composition and the per-item lock discipline ARE documented in `work/protocol/WORK-CONTRACT.md` (and CLAIM-PROTOCOL.md), so the "likely a no-op" assumption must be ACTIVELY confirmed, and any protocol-doc edit must be mirrored `skills/setup/protocol/` ↔ `work/protocol/` byte-identically per AGENTS.md. Disposition: keep.

disposition: keep
