---
title: review-gate non-blocking nits for 'drive-tasks-dispatch-allow-backlog' (Gate 2 approve)
date: 2026-06-24
status: open
reviewOf: drive-tasks-dispatch-allow-backlog
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'drive-tasks-dispatch-allow-backlog' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- The skill paraphrases the no-flag failure as throwing `no task '<slug>' found in tasks/ready/`, but the real error (prompt.ts:630) lists ALL searched folders, e.g. `no task '<slug>' found in in-progress/, tasks/ready/`. Worth tightening the quote (or marking it illustrative) so a reader debugging the message isn't surprised it also names `in-progress/`?
  (skills/drive-tasks/SKILL.md, opt-in-backlog bullet vs packages/dorfl/src/prompt.ts:600-630 — `order = ['in-progress','tasks-ready']`, `searched = order.map(...).join(', ')`. Pure doc illustration; no contract depends on the exact string, so no one is bitten.)
