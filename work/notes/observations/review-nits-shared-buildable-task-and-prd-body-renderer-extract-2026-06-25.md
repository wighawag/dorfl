---
title: review-gate non-blocking nits for 'shared-buildable-task-and-prd-body-renderer-extract' (Gate 2 approve)
date: 2026-06-25
status: open
reviewOf: shared-buildable-task-and-prd-body-renderer-extract
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'shared-buildable-task-and-prd-body-renderer-extract' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- No '## Decisions' block was recorded (the commit message is a one-line subject and there is no separate PR-description body). Three in-scope design choices the agent made on its own should be ratified by a human.
  (git log e81f8de has only the subject line; no git notes, no done-record body beyond the unchanged task file.)
- Ratify: BODY-only rendering. renderTaskBody/renderPrdBody emit only the markdown AFTER the frontmatter fence; each caller keeps its own frontmatter writer. This is the right seam (matches PRD US #5: writers stay distinct) but it is an un-stated boundary decision worth a nod.
  (buildable-body.ts module doc; renderTaskBody returns sections only, no `---` fence.)
- Ratify: empty-input fallbacks. The renderer substitutes placeholder prose for empty whatToBuild/problemStatement (e.g. '(no `## What to build` prose was supplied.)') and an empty prompt seed becomes 'Build the task described above.'. Note this default seed differs from buildPromotedBody's existing 'Build the task <slug>, described above.' When promotion is rewired to call renderTaskBody (follow-on task), that slug-bearing seed must be passed in explicitly or its output changes; flagging now so the follow-on task preserves byte-for-byte output.
  (buildable-body.ts L110 vs triage-persist.ts buildPromotedBody seed at ~L440.)
