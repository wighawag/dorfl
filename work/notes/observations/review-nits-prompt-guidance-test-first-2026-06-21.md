---
title: review-gate non-blocking nits for 'prompt-guidance-test-first' (Gate 2 approve)
date: 2026-06-21
status: open
reviewOf: prompt-guidance-test-first
needsAnswers: false
triaged: keep
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'prompt-guidance-test-first' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The keystone slice carries needsAnswers:true for both the seam mechanism (Option A conditional fragment vs B variant wrapper vs C append-line) AND the replace-vs-append phrasing question; should the slicer pre-decide one (the brief leans toward 'strengthened' = replace) to make the keystone immediately pickable, or is leaving both as the picker's ADR call the intended escape hatch?
  (prompt-guidance-testfirst-config-and-prompt-seam.md frontmatter has `needsAnswers: true`; its 'Open question' section defers two distinct decisions to the implementer/reviewer.)
- Should the env-var name be pinned at slicing time rather than left as 'DORFL_PROMPT_GUIDANCE_TEST_FIRST or whatever matches existing naming'?
  (Keystone slice §2 of 'End-to-end behaviour' hedges the env-var spelling; downstream tests will need a concrete name.)
- The item-override slice asserts a per-task > per-brief > repo precedence; the brief states the override shape but does not explicitly rank task vs brief — is this ordering already implied by how humanOnly/autoBuild compose, or is the slicer making a fresh design call that deserves an ADR?
  (prompt-guidance-testfirst-item-override.md §3 introduces the three-tier precedence; brief 'Implementation Decisions' bullet 3 says 'per-item override' without ranking task vs brief explicitly.)

## Triaged: promoted

Promoted to a new backlog slice `work/tasks/todo/review-nits-prompt-guidance-test-first-2026-06-21.md` (a human answered
"promote"). This observation is resolved; the new item carries the work.

## Triaged: maps onto an existing item

This observation maps UNAMBIGUOUSLY onto `task:review-nits-prompt-guidance-test-first-2026-06-21` (already
covered there), so it is settled — marked triaged:keep and dropped out
of the candidate pool (never re-asked).

Reason: Observation is already marked Triaged: promoted and resolved; it maps unambiguously onto the existing backlog slice of the same slug created from it.

## Resolution (recovered from an orphaned question sidecar, 2026-07-12)

CORRECTION: the promoted carrier task was DELETED in commit `d4fd53db` ("repair 12 promptless promoted tasks", GROUP A); no `task:review-nits-prompt-guidance-test-first-...` file exists. Its question sidecar (4 questions) was answered by a human, and the answers CLOSE this out entirely, so nothing needs re-minting. Recovered verbatim below before the orphaned sidecar is removed.

- **Q1 (disposition):** Close/drop as overtaken-by-events. All three captured nits were resolved when the sibling slices landed in `tasks/done/` (config-and-prompt-seam, item-override, setup-adoption-question), leaving nothing for this stub to build. Discharge via the cancelled/drop path.
- **Q2 (fragment style + REPLACE):** Discharged. q1 (Option A conditional fragment with HTML-comment markers + ADR) and q2 (REPLACE) are answered, recorded, ADR'd, and implemented in the done config-seam slice. Nothing remains.
- **Q3 (env var):** Confirmed, no follow-up. The concrete env var `DORFL_PROMPT_GUIDANCE_TEST_FIRST` is pinned in the shipped resolver (`config.ts`).
- **Q4 (precedence ADR needed?):** Sufficient as documented. The per-task > per-spec > repo precedence mirrors the existing `humanOnly`/`autoBuild` item-override shape, so the `WORK-CONTRACT.md` documentation is enough; no separate precedence ADR is owed.

NET: this observation is fully discharged (overtaken by events); no work is owed.
