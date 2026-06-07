---
title: review-gate non-blocking nits for 'review-comment-prose-field' (Gate 2 approve)
date: 2026-06-07
status: open
slug: review-comment-prose-field
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'review-comment-prose-field' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for batch-qa triage (promote-to-slice / keep / delete).

- AC #5 ("a block that IS posted as a PR posts its review prose too") is partially aspirational in the current flow: `approvedVerdict` is only assigned on the approve path, and a block routes to needs-attention before step 6, so no block ever reaches the poster today. The poster correctly posts `verdict.review` regardless of verdict (so it's future-proof), and the parse test covers a block carrying `review`, but no integration test exercises a block actually reaching `postComment` — because the flow makes that unreachable. Is the slice's wording ("a block that IS posted as a PR") describing a future capability rather than a path this diff activates?
  (integration-core.ts step 6 guard is `approvedVerdict?.review !== undefined`; `approvedVerdict = lastVerdict` is set only inside the approve branch (after `note('PR/code review (Gate 2) approved')`). The slice itself frames this as conditional ("IF a block is ever posted as a PR"; resolved QA #4), so this is a consistency note, not a missing behaviour — the poster is verdict-agnostic as specified.)
