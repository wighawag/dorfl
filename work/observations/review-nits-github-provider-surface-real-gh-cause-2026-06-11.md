---
title: review-gate non-blocking nits for 'github-provider-surface-real-gh-cause' (Gate 2 approve)
date: 2026-06-11
status: open
slug: github-provider-surface-real-gh-cause
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'github-provider-surface-real-gh-cause' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The slice EXPLICITLY required recording the sharing choice in a `## Decisions` block, but the work is still uncommitted (only the `claim:` commit exists) so there is no PR description yet. Confirm the PR description carries a `## Decisions` block recording: 'Chose option (b) — lifted the whole undefined-vs-RunResult→reason-string PAIR into a new shared leaf module `src/gh-failure.ts` (exports `ghFailureReason`, `ghFailureDetail`, `GH_BINARY_MISSING`), imported by both providers, so the two gh seams cannot drift on the next fix.' This was the one explicit recorded-decision deliverable of the slice.
  (Slice acceptance criterion: 'the chosen sharing approach recorded in a ## Decisions block'. The implementation took the slice-preferred option (b) cleanly; the only gap is that the rationale must surface in the PR description for the human to ratify.)
- Coherence/residual-duplication: the new shared module exports `ghFailureDetail` (the undefined-vs-RunResult PAIR) AND a `GH_BINARY_MISSING` constant, but issue-provider.ts adopts ONLY `ghFailureReason` — it keeps ~5 inline copies of the two-arm `result === undefined ? '\`gh\` is not available (binary missing).' : ghFailureReason(result)` guard and the literal binary-missing string rather than calling `ghFailureDetail` / referencing `GH_BINARY_MISSING`. Is leaving issue-provider's inline guards as-is intended (the slice scoped issue-side as 'unchanged'), or should a follow-up converge issue-provider onto `ghFailureDetail`/`GH_BINARY_MISSING` so the shared module is the genuine single source of truth?
  (The shared module's stated purpose is 'the single source of truth so the two providers can NEVER drift apart.' github.ts fully adopts the pair; issue-provider only adopts half of it, so the binary-missing string + the two-arm shape still exist in two places (the literals happen to match today). This does not break this slice — issue-side behaviour is correctly unchanged and the literals are byte-identical to the exported constant — but it is exactly the drift surface the module was created to eliminate, and is a natural follow-up slice rather than a defect in this one.)
