---
title: Tighten the no-flag error-string quote in drive-tasks SKILL.md
slug: review-nits-drive-tasks-dispatch-allow-backlog-2026-06-24
needsAnswers: false
blockedBy: []
---

## What to build

Fix a small doc inaccuracy in `skills/drive-tasks/SKILL.md` (the opt-in-backlog
bullet). It paraphrases the no-flag failure as throwing
`no task '<slug>' found in tasks/ready/`, but the real error
(`packages/dorfl/src/prompt.ts:~630`) lists ALL searched folders, e.g.
`no task '<slug>' found in in-progress/, tasks/ready/` (the search `order` is
`['in-progress','tasks-ready']`, joined). Tighten the quote to match the real
string, or mark it illustrative, so a reader debugging the message is not
surprised it also names `in-progress/`. Skill-doc only; no contract depends on
the exact string.

## Acceptance criteria

- [ ] The quoted error string in the drive-tasks opt-in-backlog bullet either
      matches the real `resolveTask` error (naming all searched folders) or is
      explicitly marked illustrative.
- [ ] Skill-doc only; no code change.
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- None — can start immediately.

## Prompt

> Goal: tighten the illustrative error-string quote in
> `skills/drive-tasks/SKILL.md` (opt-in-backlog section) so it matches what
> `resolveTask` actually throws.
>
> Where to look: `skills/drive-tasks/SKILL.md` (the opt-in-backlog bullet quoting
> `no task '<slug>' found in tasks/ready/`) vs `packages/dorfl/src/prompt.ts`
> ~L600-630, where `searched = order.map(...).join(', ')` over
> `order = ['in-progress','tasks-ready']` — so the real message names
> `in-progress/` too. Either reproduce the real string or mark the quote
> illustrative. Note: `skills/drive-tasks/SKILL.md` is this repo's own copy
> (the `~/.agents/skills/drive-tasks/` path resolves to the same repo); edit it
> in place. Doc only; keep the gate green.
