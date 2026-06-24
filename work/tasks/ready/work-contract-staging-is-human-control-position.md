---
title: WORK-CONTRACT.md — state that staging is also the human-control position
slug: work-contract-staging-is-human-control-position
prd: do-allow-backlog-drive-staged-tasks-without-promotion
blockedBy: []
covers: [6]
humanOnly: true
---

## What to build

Add the general principle to `WORK-CONTRACT.md` so the next author reaches for
drive-in-place, not promote-then-drive — generalising both the PRD-tasking fix
(instance 1) and the `--allow-backlog` task fix (instance 2).

End-to-end behaviour (protocol-doc only):

- In the staging description (and/or the position/`humanOnly`-is-narrow section),
  state: a staging folder (`tasks/backlog/`, `prds/proposed/`) is review-first
  admission AND the HUMAN-CONTROL position. Promoting an item into the pool
  (`tasks/ready/`, `prds/ready/`) surrenders it to ANY claimer (a CI `advance`
  leg, a local `run` daemon) — so a human who wants to DRIVE an item themselves
  drives it IN PLACE from staging, never promote-then-drive (which opens a
  competition window). Cross-reference the mechanisms: PRDs task in place
  (TASKING-PROTOCOL.md §6); tasks build in place via `do --allow-backlog`.
- This is a PROTOCOL-DOC edit: per AGENTS.md, edit the SOURCE
  `skills/setup/protocol/WORK-CONTRACT.md` and mirror BYTE-IDENTICALLY into
  `work/protocol/WORK-CONTRACT.md` (`diff -r skills/setup/protocol work/protocol`
  stays clean apart from files that legitimately live in only one, e.g.
  `VERSION`).

## Acceptance criteria

- [ ] WORK-CONTRACT.md states the staging-is-also-the-human-control-position
      principle, with the promote-then-drive competition window named and both
      drive-in-place mechanisms cross-referenced.
- [ ] SOURCE (`skills/setup/protocol/`) and MIRROR (`work/protocol/`) copies of
      WORK-CONTRACT.md are byte-identical (`diff` clean for this file).
- [ ] Acceptance gate green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None — can start immediately (protocol docs; file-orthogonal to the code
  tasks).

## Prompt

> Goal: generalise the staging-is-also-the-human-control-position principle into
> WORK-CONTRACT.md, per the PRD
> `do-allow-backlog-drive-staged-tasks-without-promotion` (US #6, Resolved
> decision 7).
>
> Where to look: the staging-folder descriptions (the `tasks/`/`prds/` lifecycle
> layout) and the "Task `humanOnly` is NARROW — POSITION carries review-first"
> section. Add: staging is review-first admission AND the human-control position;
> promoting to the pool surrenders the item to any claimer (CI `advance` / a
> local `run` daemon, both pool-only), so "I want to drive this myself" = drive
> in place. Cross-reference TASKING-PROTOCOL.md §6 (PRDs task in place) and
> `do --allow-backlog` (tasks build in place).
>
> CRITICAL (AGENTS.md): this repo AUTHORS the protocol. Edit the SOURCE
> `skills/setup/protocol/WORK-CONTRACT.md`, then mirror the identical change into
> `work/protocol/WORK-CONTRACT.md` so the two stay byte-identical. Editing the
> `work/protocol/` copy alone drifts it and the next `setup` reverts it.
>
> "Done" = the principle is stated, the two copies are byte-identical, and the
> gate is green.
