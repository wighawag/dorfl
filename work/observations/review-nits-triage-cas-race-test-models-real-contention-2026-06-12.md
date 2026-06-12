---
title: review-gate non-blocking nits for 'triage-cas-race-test-models-real-contention' (Gate 2 approve)
date: 2026-06-12
status: open
slug: triage-cas-race-test-models-real-contention
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'triage-cas-race-test-models-real-contention' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the root-cause correction: the slice hypothesised the flake was the `--force-with-lease` local-transport lease blind spot or `Promise.all` interleave and prescribed candidate fixes A (atomic/server-authoritative arbiter), B (separate OS processes), or C (test mutex). The builder instead reproduced + instrumented and found a DIFFERENT cause — byte-identical commit shas from identical committer identity + tree + message + base — and fixed it with distinct per-racer identities (`racerEnv`/`raceClone`), which is none of A/B/C. The slice authorized choosing by what reproduction shows, so this is in-bounds, but the deviation from the prescribed menu is a design decision worth a conscious nod.
  (Root cause verified against `src/ledger-write.ts` applyTransition: the post-push verify is `arbiterHead === head` (ledger-write.ts:380), comparing the arbiter's main sha to the racer's OWN commit sha — so two byte-identical commits both pass verify. Distinct identities → distinct shas → the loser's lease/verify correctly fails. The fix faithfully models production (real principals have distinct identities) and preserves `won/lost.toHaveLength(1)`.)
- The slice's acceptance criteria and Prompt asked for the confirmed mechanism to be recorded in a `## Decisions` block. There is no such block in a PR description; the diagnosis + decision rationale instead live in the four resolved-observation notes (`work/observations/*`). The substance is fully present and clear — just confirm the observation notes are the accepted home for it rather than expecting a separate Decisions section.
  (All four source observations carry a `## RESOLVED 2026-06-12` block stating the sha-collision root cause, the test-only nature, the unchanged product CAS, the preserved invariant, and 8 consecutive green runs. The slice is still in `work/in-progress/` (not yet moved to `work/done/`), consistent with the runner/human owning the done-move.)
