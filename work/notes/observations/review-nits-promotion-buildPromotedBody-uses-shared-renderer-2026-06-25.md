---
title: review-gate non-blocking nits for 'promotion-buildPromotedBody-uses-shared-renderer' (Gate 2 approve)
date: 2026-06-25
status: open
reviewOf: promotion-buildPromotedBody-uses-shared-renderer
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'promotion-buildPromotedBody-uses-shared-renderer' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Empty-mechanism placeholder text changed: a promoted observation with NO mechanism prose (only a `## Open questions` body, or fully empty) now renders the lead section placeholder as '(no `## What to build` prose was supplied.)' / '(no `## Problem Statement` prose was supplied.)' instead of the pre-rewire '(no mechanism/fix prose was carried from the observation.)'. The task asked for byte-for-byte-unchanged output; this is the ONE remaining byte-level divergence (the common non-empty path and the fence spacing are now provably identical for both task and PRD). Impact is cosmetic: it is human-readable filler in a rare, reachable edge (the new empty-mechanism test exercises it), no validator/consumer reads it, dispatchability and semantics are unchanged. Adopting the renderer's canonical placeholder is arguably the INTENDED consequence of centralizing the schema, and that placeholder was already flagged for ratification at the keystone review (work/questions/observation-review-nits-shared-buildable-task-and-prd-body-renderer-extract-2026-06-25.md). Worth a human glance to confirm the slightly-reworded empty-mechanism filler is acceptable; the new empty-mechanism test asserts only the `## Prompt` seed, not this `## What to build` placeholder, so the same byte-drift-the-test-misses pattern that caused the prior fence-spacing requeue recurs here uncaught.
  (src/buildable-body.ts:93,143 vs pre-rewire triage-persist.ts placeholder; verified divergence only on empty mechanism.trim()==='')
- No `## Decisions` block was recorded (the done record and both commit bodies are empty of one), though the task explicitly said 'Record any non-obvious decision in the done record'. Two in-scope decisions the agent made on its own should be ratified by a human: (1) OWNERSHIP OF THE FENCE SEPARATOR — the frontmatter writer now owns the single blank line between the `---` fence and the first heading (fenceToBody = frontmatter.join('\n') + '\n\n') because the shared renderer starts at its heading with no leading blank; this convention is load-bearing for intake too when it adopts the renderer (the sibling task), so it is a cross-task interaction worth pinning. (2) ADOPTING the shared renderer's empty-prose placeholder (finding 1). Both are non-obvious and currently captured only as inline code comments, not as a ratifiable decision record.
  (task body: 'Record any non-obvious decision in the done record'; no ## Decisions block found)
