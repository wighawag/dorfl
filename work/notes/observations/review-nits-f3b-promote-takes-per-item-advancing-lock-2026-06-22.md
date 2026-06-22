---
title: review-gate non-blocking nits for 'f3b-promote-takes-per-item-advancing-lock' (Gate 2 approve)
date: 2026-06-22
status: open
reviewOf: f3b-promote-takes-per-item-advancing-lock
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'f3b-promote-takes-per-item-advancing-lock' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the in-scope decision: `promote` (both task and brief) reuses the existing `action: advance` lock value rather than introducing a distinct `'promote'` action — and ratify that the recording lives only in a code comment, NOT in a `## Decisions` block of the done record (slice acceptance criterion explicitly required one of: ADR or `## Decisions` note in the done record).
  (Slice acceptance criterion: "Any decision (reuse `advance` action value vs introduce `'promote'`) is RECORDED per the task template — as an ADR if it meets the ADR gate, otherwise a `## Decisions` note in the done record." The done record `work/tasks/done/f3b-promote-takes-per-item-advancing-lock.md` has no `## Decisions` section. The decision IS clearly explained in two long block comments in `packages/agent-runner/src/needs-attention.ts` (around the `promoteFromPreBacklog` and `promoteFromPrePrd` lock acquires) and reaffirmed in the test file's preamble, and the chosen design matches what the slice's Prompt already recommended (PRD q2/q4: keep one ref per item, three transitions of one item must serialise on it). So the design choice is sound; only the recording location deviates from the template.)
- User-visible prose drift: the promote path still emits `pre-backlog`/`work/backlog/`/`pre-prd`/`work/prd/` in `note()` messages, the early-exit `reasonNotMoved` text, and the commit subject (`chore(<slug>): promote work/pre-backlog/ -> work/backlog/`) even though F1 just renamed the pool to `tasks/todo`. This is PRE-EXISTING (F3b did not touch those strings — it wrapped them in a try/finally) and arguably out of F3b's scope, but the diff is the natural place to notice it because F3b touches these functions. Worth a small follow-up slice to align the user-facing language with the new `todo` noun.
  (packages/agent-runner/src/needs-attention.ts:818-825 (`'… is not staged in work/pre-backlog/ on …' and `chore(${slug}): promote work/pre-backlog/ -> work/backlog/`), line 863 (`Promoted '${slug}' from pre-backlog to backlog`), line 869 (`item left in pre-backlog`), and the symmetric brief block (lines 1034-1050).)
