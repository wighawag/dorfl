---
title: review-gate non-blocking nits for 'advance-autopick-lifecycle-pools' (Gate 2 approve)
date: 2026-06-13
status: open
slug: advance-autopick-lifecycle-pools
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'advance-autopick-lifecycle-pools' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the SURFACE-vs-APPLY dispatch design: a `needsAnswers`-blocked slice/PRD is selected into EITHER the surface or the apply sub-pool, but BOTH dispatch to the same tick arg (bare `<slug>` for a slice, `prd:<slug>` for a PRD) and rely on the tick's `classifyTick` to re-split them by sidecar answered-state. The `SelectedItem.namespace` discriminator therefore does NOT distinguish surface from apply (both are `slice`/`prd`); only `observation` gets a dedicated `obs:` arg. Is delegating the surface/apply split to the (unchanged) classifier the intended design rather than carrying it in the selected item?
  (src/advance-drivers.ts `argForSelectedItem` and src/advance-loop-driver.ts `argForSelected` both map slice->bare, prd->`prd:`. The split is decided in buildLifecyclePools (apply if sidecar allAnswered, else surface) for POOL ORDERING, but the ARG is identical, so the tick re-derives it via classifyTick reading the item's needsAnswers flag + sidecar. This is consistent with the slice's stated 'the tick re-classifies each arg' premise and the 'classifier/rungs unchanged' criterion, and is verified correct (a bare-slug needsAnswers item does not hit the build pipeline). Flagging only because it is a non-obvious in-scope choice the PR did not record in a `## Decisions` block.)
- Ratify the dual reader of the `triaged` marker: this slice adds `triaged` as a parsed `Frontmatter` field (any non-empty value = settled), while `apply-persist.ts` retains its own `isTriagedKeep` regex reader (narrowed to the `keep` value). Should a follow-up consolidate apply-persist onto the new parsed field, or is the duplication intentional?
  (src/frontmatter.ts (new `triaged` field) vs src/apply-persist.ts:503 `isTriagedKeep` (pre-existing regex, value=`keep`). They do not contradict (both treat non-empty triaged as settled; isTriagedKeep additionally checks the specific value for apply semantics), so this is not a coherence block — just two parse paths for one marker that could later be unified.)
