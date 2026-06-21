<!-- agent-runner-sidecar: item=observation:review-nits-staging-surface-and-apply-promote-safety-2026-06-21 type=observation slug=review-nits-staging-surface-and-apply-promote-safety-2026-06-21 allAnswered=false -->

## Q1

**Finding 1 — F3a/F3b's `blockedBy: [f1]` is flagged as a serialisation hedge, not a semantic prerequisite. Should we (a) drop/relax the blocker now (promote a tiny slice to re-examine and remove it if surfaces are confirmed disjoint), (b) keep the observation as a note for the runner so dispatch can override if F1 stalls, or (c) delete it as not worth tracking?**

> Review gate found that F3a edits `apply-persist.ts` + an identity-keyed resolver and F3b edits promote's position-CAS path; neither obviously reads the `state.backlog` pool-noun that F1 renames. The blocker is justified as 'touches overlapping readers / config doc-comments; serialise to avoid merge conflicts' — reasonable but conservative. Not a correctness defect.

_Suggested default: keep — record as a hint for the runner that the dependency is a serialisation hedge; do not spend a slice on it unless F1 actually stalls_

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):

## Q2

**Finding 2 — should F2 (new `surfaceStaging` config key) and F3b (changed lock discipline of `promote`) mirror anything into `skills/setup/protocol/` and `work/protocol/`, and if so should that mirroring be promoted as its own slice, folded into the existing F2/F3b slices, or dropped as a no-op?**

> F1 already calls out the AGENTS.md protocol-doc mirroring rule for renames. F2/F3b acceptance criteria do not mention protocol-doc mirroring. The reviewer judged it 'likely a no-op (behavioural/config changes, not contract-doc changes)' but worth a quick check during build to confirm no doc in `skills/setup/protocol/` actually documents the surface-pool composition or the per-item lock's coverage of promote.

_Suggested default: keep — perform the quick grep during F2/F3b build; promote a follow-up slice only if a protocol doc is actually found to document the affected surface_

<!-- q2 fields: id=q2 disposition=keep -->

**Your answer** (write below this line):
