---
title: 'The apply rung appends ''## Applied answers'' but leaves the now-stale ''## Open questions'' section AND the ''Set needsAnswers:true'' autonomy note in the brief body'
date: 2026-06-21
status: open
triaged: keep
---

## What was spotted

Testing the advance APPLY step end-to-end: brief `staging-surface-and-apply-promote-safety` had 4 `needsAnswers` questions surfaced, we answered the sidecar, pushed, and CI applied them (commit `2eeb56a advance: resolve brief:...`). Apply worked correctly on the load-bearing invariants: `needsAnswers` flipped to `false`, the sidecar was deleted in the same commit (the `needsAnswers:false <=> no active sidecar` invariant), and the answers were folded into a new `## Applied answers 2026-06-21` body section.

BUT apply left the brief body internally contradictory:

1. The original **`## Open questions (clear needsAnswers when resolved)`** section is STILL present, listing all 4 questions as if unanswered, right above the new `## Applied answers` section.
2. The **Autonomy notes** line still reads "Set `needsAnswers: true`: there are real open questions below ... Clear once answered."

So a `needsAnswers:false` brief still reads, in its own body, as if it is awaiting answers. A human (or the slicer about to slice it) sees an "open questions" section next to an "applied answers" section and cannot tell the brief is resolved from the body alone (only the frontmatter flag says so).

## Why it matters

The slicer is the next consumer of this brief. A stale "## Open questions" section risks the slicer re-treating answered questions as open, or duplicating them into slices. More generally it is claim-vs-reality drift the apply rung itself introduces: the durable record (frontmatter `needsAnswers:false` + the answers) contradicts the transient prose (the open-questions section + the autonomy note).

## Suggested fix (for triage)

The apply rung should RECONCILE, not just append. Options:
- Apply DELETES (or strikes through) the `## Open questions` section when it folds in the answers, since the answers now supersede it.
- OR the brief template separates a TRANSIENT "open questions" block (which apply removes) from the durable record, so apply knows exactly what to clear.
- AND apply should neutralise the now-false autonomy-note instruction, or the template should keep that instruction OUT of the durable body (it is authoring guidance, not brief content).

The honest end state: after apply, the brief body reads as RESOLVED, with the answers present and no leftover "these are still open" prose.

## Provenance

Spotted by the user + investigation while testing the apply step during the v1.0.0-skills-alignment session (2026-06-21). The apply itself succeeded (invariants held); this is a body-reconciliation quality gap, not a correctness failure of the flag/sidecar invariant.

## Triaged: maps onto an existing item

This observation maps UNAMBIGUOUSLY onto `brief:apply-reconciles-stale-open-questions` (already
covered there), so it is settled — marked triaged:keep and dropped out
of the candidate pool (never re-asked).

Reason: The ready brief `apply-reconciles-stale-open-questions` explicitly cites this observation as its originating signal and captures the exact problem (apply appends `## Applied answers` but leaves the stale `## Open questions` section and autonomy note), with decisions/tests already drafted. The observation is already covered.
