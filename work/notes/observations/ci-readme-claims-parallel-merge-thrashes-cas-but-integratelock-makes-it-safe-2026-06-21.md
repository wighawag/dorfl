---
title: '`docs/ci/README.md` still says parallel merge thrashes the CAS, but `integrateLock` + `mergeRetries` now make concurrent merge safe'
type: observation
status: spotted
spotted: 2026-06-21
triaged: keep
---

# `docs/ci/README.md` still says parallel merge thrashes the CAS, but `integrateLock` + `mergeRetries` now make concurrent merge safe

2026-06-21

`docs/ci/README.md` (the advance-loop CI template doc) states the merge shape is a
**single sequential job** because "parallel merge jobs would thrash the main-CAS"
(the two-shapes table + the prose under it). That justification predates the
land-tail concurrency seam that now exists in `integration-core.ts`:

- `integrateLock(key, fn)` (keyed on `repoPath`) serialises ONLY the
  rebase-to-integrate TAIL, so same-repo merge jobs land on `main` one-at-a-time
  while their build/gate/review run concurrently. `run.ts` already wires this via
  `createKeyedLock()` for the in-process fleet.
- `mergeRetries` (default 5) + the retry loop around `applyCompleteTransition`
  turns a non-fast-forward push (a sibling advanced `main`) into a re-rebase +
  re-gate + retry, never a thrash and never a `--force`.

So the engine now SUPPORTS concurrent merge with deterministic landing; the CI
doc's "single sequential merge job" is a stale constraint, not a real one. The
`run` fleet already gets ultimate-parallelism-for-merge (parallel build, serialised
land). The CI template shape has not been updated to drive a parallel merge matrix.

Two caveats to resolve before changing the CI shape (captured in sibling notes):
the in-memory `integrateLock` does NOT span separate CI jobs (cross-job landing
falls back to the CAS retry loop alone), and the retry cap was sized for in-process
siblings, not a wide matrix.

Not fixing here: this is a doc-vs-code drift signal + a CI-shape upgrade
opportunity, not a change to make mid-discussion.

## Triaged: maps onto an existing item

This observation maps UNAMBIGUOUSLY onto `briefs/ready:land-time-reverify-and-parallel-merge-ceiling` (already
covered there), so it is settled — marked triaged:keep and dropped out
of the candidate pool (never re-asked).

Reason: The observation is explicitly cited in this brief's launch snapshot as one of its originating design-trail observations, and its substance (docs/ci/README.md's 'parallel merge thrashes CAS' justification is stale given integrateLock + mergeRetries; CI shape should fan out merge) is directly covered by the brief's Problem Statement §2, User Story 6, and the CI-template solution. No additional signal to extract.

## Triaged: maps onto an existing item

This observation maps UNAMBIGUOUSLY onto `briefs/ready:land-time-reverify-and-parallel-merge-ceiling` (already
covered there), so it is settled — marked triaged:keep and dropped out
of the candidate pool (never re-asked).

Reason: Observation already self-declares it maps onto this brief (cited in launch snapshot; substance covered by Problem Statement §2, User Story 6, CI-template solution). Brief file confirms the reference.

## Triaged: maps onto an existing item

This observation maps UNAMBIGUOUSLY onto `briefs/ready:land-time-reverify-and-parallel-merge-ceiling` (already
covered there), so it is settled — marked triaged:keep and dropped out
of the candidate pool (never re-asked).

Reason: Observation is explicitly cited in the brief's launch snapshot as an originating signal, and its substance (stale docs/ci/README.md justification vs. integrateLock + mergeRetries enabling concurrent merge; CI shape upgrade) is directly covered by the brief's Problem Statement §2, User Story 6, and CI-template solution. Observation self-declares the mapping.
