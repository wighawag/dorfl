---
title: review-gate non-blocking nits for 'prompt-guidance-test-first' (Gate 2 approve)
date: 2026-06-21
status: open
reviewOf: prompt-guidance-test-first
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'prompt-guidance-test-first' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The keystone slice carries needsAnswers:true for both the seam mechanism (Option A conditional fragment vs B variant wrapper vs C append-line) AND the replace-vs-append phrasing question; should the slicer pre-decide one (the brief leans toward 'strengthened' = replace) to make the keystone immediately pickable, or is leaving both as the picker's ADR call the intended escape hatch?
  (prompt-guidance-testfirst-config-and-prompt-seam.md frontmatter has `needsAnswers: true`; its 'Open question' section defers two distinct decisions to the implementer/reviewer.)
- Should the env-var name be pinned at slicing time rather than left as 'AGENT_RUNNER_PROMPT_GUIDANCE_TEST_FIRST or whatever matches existing naming'?
  (Keystone slice §2 of 'End-to-end behaviour' hedges the env-var spelling; downstream tests will need a concrete name.)
- The item-override slice asserts a per-task > per-brief > repo precedence; the brief states the override shape but does not explicitly rank task vs brief — is this ordering already implied by how humanOnly/autoBuild compose, or is the slicer making a fresh design call that deserves an ADR?
  (prompt-guidance-testfirst-item-override.md §3 introduces the three-tier precedence; brief 'Implementation Decisions' bullet 3 says 'per-item override' without ranking task vs brief explicitly.)
