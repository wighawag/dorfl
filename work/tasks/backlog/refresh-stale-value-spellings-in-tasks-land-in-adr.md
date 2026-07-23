---
title: 'Refresh stale value spellings in the tasks-land-in-precedence ADR (amendment banner)'
slug: refresh-stale-value-spellings-in-tasks-land-in-adr
blockedBy: []
covers: []
---

## What to build

`docs/adr/tasks-land-in-runner-deterministic-precedence.md` still uses several OLD config-value spellings from before later renames: `pre-backlog` (now `backlog`), `todo` (now `ready` — already covered by an existing amendment banner), `prdsLandIn` (now `specsLandIn`), and `pre-proposed` (now `proposed`, renamed by task `specs-land-in-proposed-rename`). Bring the ADR into line with the live vocabulary the SAME way it already handles the `todo → ready` rename: via an AMENDMENT BANNER (the house convention — the ADR at the top already carries a `todo → ready` banner), NOT by rewriting the historical decision text wholesale.

Add/extend the amendment banner so a reader maps every stale value spelling to the current one (`pre-backlog → backlog`, `prdsLandIn → specsLandIn`, `pre-proposed → proposed`), consistent with the existing `todo → ready` banner. Do NOT touch the on-disk folders or any code — this is a docs-vocabulary refresh only. Keep the historical decision text intact under the banner (ADRs record the decision as made; the banner reconciles the vocabulary).

## Acceptance criteria

- [ ] The ADR carries an amendment banner mapping every stale value spelling (`pre-backlog`, `prdsLandIn`, `pre-proposed`) to its current one, matching the style of the existing `todo → ready` banner.
- [ ] No historical decision text is deleted/rewritten (banner-only reconciliation, per ADR convention).
- [ ] No code or on-disk folder is changed (docs-only).
- [ ] The build/format/test gate stays green (this is a Markdown-only change).

## Blocked by

- None — can start immediately. (The `pre-proposed → proposed` rename it references already landed in `tasks/done/specs-land-in-proposed-rename.md`.)

## Prompt

> Goal: reconcile the stale config-value spellings in `docs/adr/tasks-land-in-runner-deterministic-precedence.md` with the live vocabulary, using an amendment banner (the convention this ADR already uses for the `todo → ready` rename).
>
> Context: the ADR is an accepted historical decision record. It predates several renames: `pre-backlog → backlog` and `todo → ready` (folder-taxonomy work), `prdsLandIn → specsLandIn` (prd→spec cutover), and `pre-proposed → proposed` (task `specs-land-in-proposed-rename`, now in `tasks/done/`). The ADR ALREADY has an amendment banner at the top for `todo → ready` — follow that exact pattern for the other three, rather than editing the body's historical text. ADRs record the decision as made; a banner reconciles the vocabulary drift without falsifying the history.
>
> Where to look: `docs/adr/tasks-land-in-runner-deterministic-precedence.md` (the top amendment banner + the value spellings around the config-key and precedence sections). Grep it for `pre-backlog`, `prdsLandIn`, `pre-proposed`. Finding that motivated this: `work/notes/observations/adr-tasks-land-in-precedence-has-stale-value-spellings-2026-07-23.md`. Do NOT touch code, folders, or other ADRs (only this one drifted — verified by grep).
>
> Done: the banner maps every stale spelling to current, historical text intact, docs-only, gate green.
