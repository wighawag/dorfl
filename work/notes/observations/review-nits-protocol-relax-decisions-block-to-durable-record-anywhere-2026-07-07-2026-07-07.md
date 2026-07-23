---
title: 'review-gate non-blocking nits for ''protocol-relax-decisions-block-to-durable-record-anywhere-2026-07-07'' (Gate 2 approve)'
date: 2026-07-07
status: open
reviewOf: protocol-relax-decisions-block-to-durable-record-anywhere-2026-07-07
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'protocol-relax-decisions-block-to-durable-record-anywhere-2026-07-07' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: the done record (the task file moved to work/tasks/done/) contains no explicit backlink to the source observation slug and no ## Decisions entry recording the wording choices, even though the acceptance criteria say to 'dogfood the relaxed convention' and link the source observation. The observation slug IS mentioned in the task's ## Why body (inherited from the ready file) and the source observation file itself was cleaned up during promotion (36f0b999), so there is nothing new to link — is that link-via-Why good enough, or does the human want an explicit ## Decisions/link block appended to the done record?
  (Acceptance bullet: 'Done record links to this task and to the source observation ... and durably records any non-obvious wording choices per the NEW rule'. Commit a8503393 body is empty; done file is unchanged from the ready file.)
- Ratify in-scope wording choice: the new CLAIM-PROTOCOL text names 'a dated observation note under work/notes/observations/' as one of the three acceptable durable homes, which hard-codes a folder path into the protocol doc. The task said 'observation note' generically; picking that concrete path (correct for this repo) is a small unspecified decision.
  (work/protocol/CLAIM-PROTOCOL.md ~L146: 'or a dated observation note under work/notes/observations/'.)

## Applied answers 2026-07-12

### q1: Is the source-observation link via the task's ## Why body good enough for the done record, or do you want an explicit ## Decisions / backlink block appended to work/tasks/done/protocol-relax-decisions-block-to-durable-record-anywhere-2026-07-07.md?

Accept as-is. Under the newly-relaxed rule any durable + linked home counts, and the source-observation link via the task's ## Why body satisfies that. Close the nit without editing the done record; no explicit ## Decisions/backlink block is required.

### q2: Ratify the wording choice of hard-coding 'work/notes/observations/' as the concrete folder path in CLAIM-PROTOCOL.md's list of durable homes, or should it stay generic ('an observation note')?

Ratify the concrete path. Keeping 'work/notes/observations/' in CLAIM-PROTOCOL.md's list of durable homes matches the WORK-CONTRACT folder layout the protocol already assumes elsewhere, and setup-inheriting repos get the same layout, so the concrete path is correct and more useful than a generic 'an observation note'.
