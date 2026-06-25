---
title: review-nits-drive-tasks-dispatch-allow-backlog-2026-06-24
slug: review-nits-drive-tasks-dispatch-allow-backlog-2026-06-24
needsAnswers: false
blockedBy: []
---

## What to build

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'drive-tasks-dispatch-allow-backlog' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- The skill paraphrases the no-flag failure as throwing `no task '<slug>' found in tasks/ready/`, but the real error (prompt.ts:630) lists ALL searched folders, e.g. `no task '<slug>' found in in-progress/, tasks/ready/`. Worth tightening the quote (or marking it illustrative) so a reader debugging the message isn't surprised it also names `in-progress/`?
  (skills/drive-tasks/SKILL.md, opt-in-backlog bullet vs packages/dorfl/src/prompt.ts:600-630 — `order = ['in-progress','tasks-ready']`, `searched = order.map(...).join(', ')`. Pure doc illustration; no contract depends on the exact string, so no one is bitten.)

## Requeue 2026-06-25

Requeued: promotion produced a body with no '## Prompt' section, so the dispatched build failed and left this lock state:stuck. See work/notes/observations/advance-promotion-builds-promptless-task-that-self-claims-stuck-2026-06-25.md. Body needs a '## Prompt' (or re-triage out of ready/) before re-claim. No work branch existed, so --reset.
