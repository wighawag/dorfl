---
title: <Human Readable Title>
slug: <url-safe-slug>
# issue: 123          # optional: the issue this brief was spawned from (the surviving thread)
# humanOnly: true     # optional: a HUMAN must drive the slicing of this brief (a decision). OMIT otherwise.
# needsAnswers: true  # optional: open questions block AUTO-slicing (spec incomplete). OMIT otherwise. List the questions in the body.
# briefAfter: []      # optional: brief slugs that must be SLICED first (so this brief's tasks can reference their slugs in blockedBy).
# promptGuidance.testFirst: true  # optional per-item NUDGE override: pin the test-first nudge ON (true) or OFF (false) for every task this brief fans out, regardless of the repo's resolved policy. A per-task override still wins over this. OMIT to inherit the repo policy. NEVER an acceptance criterion — `verify` still decides pass/fail.
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/todo/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is sliced — they move into tasks/ADRs and this brief settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

<!-- open-questions -->
<!--
  TRANSIENT BLOCK — stripped by the apply rung on full resolution.
  While the spec has unresolved questions blocking autonomous slicing:
    1. Set `needsAnswers: true` in the frontmatter above.
    2. List the questions under the `## Open questions` heading below.
    3. Clear the flag (and let apply strip this block) once they are answered.
  Delete the whole fenced block — markers and all — if the brief launches fully resolved.
-->

## Open questions

1. <question one>
2. <question two>

<!-- /open-questions -->

## Problem Statement

The problem the user faces, from the user's perspective.

## Solution

The solution, from the user's perspective.

## User Stories

A LONG, numbered list — the heart of the brief. Format:

1. As a <actor>, I want <feature>, so that <benefit>.

Cover all aspects of the feature, extensively.

### Autonomy notes (the two gate axes — set the frontmatter flags accordingly)

The brief now CARRIES the slicing gate (because an agent may auto-slice it with no human in the loop). Record, in prose here AND as the frontmatter flags above:

- **`humanOnly` (DECIDED):** set `humanOnly: true` on the brief ONLY to mean "a human must drive the _slicing_ of this brief" (sole effect: an agent may not auto-slice it). This is DISJOINT from task `humanOnly` — it does NOT propagate to or guide the tasks' gates (a `humanOnly` brief can yield fully agent-buildable tasks). The slicer sets each task's gate from that task's own build-nature.
- **`needsAnswers` (DISCOVERED):** are there open questions the spec has not yet resolved? If so, fill in the `## Open questions` block at the top of the brief (it carries the authoring instructions and the marker fence the apply rung uses to strip it on resolution) — the auto-slicer will refuse to slice until they are answered and the flag cleared. Be HONEST: a flagged-incomplete brief is correct; a falsely-complete one produces wrongly-cut tasks. (Omit both flags if everything is resolved and straightforwardly agent-sliceable.)

## Implementation Decisions

Decisions made at launch (modules to build/modify, interfaces, architectural choices, schema, API contracts, specific interactions). No file paths or code snippets (they go stale) — except a decision-encoding snippet from a prototype (state machine, reducer, schema, type shape), trimmed to the decision-rich part.

> Trimmed at slice-time: this detail moves into the tasks (what to build) and, where it's a durable rationale, into an ADR (`docs/adr/`). It is here only to seed the slicing.

## Testing Decisions

What makes a good test (external behaviour, not implementation details); which modules/seams will be tested; prior art in the codebase.

> Also trimmed at slice-time (moves into tasks' acceptance criteria / an ADR).

## Out of Scope

What is deliberately not being done (and, where useful, where it lives instead — e.g. an incubating idea in `work/notes/ideas/`).

## Further Notes

Anything else worth recording at launch.
