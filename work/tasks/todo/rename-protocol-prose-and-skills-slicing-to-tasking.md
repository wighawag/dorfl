---
title: Cut remaining protocol-doc prose + skills SKILL.md over to task/brief/tasking vocabulary
slug: rename-protocol-prose-and-skills-slicing-to-tasking
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: [rename-protocol-doc-slicing-to-tasking]
covers: []
---

## What to build

Sweep the remaining retired-vocabulary PROSE out of the protocol docs (other than the already-renamed TASKING-PROTOCOL.md) and the skills, mirroring source→`work/protocol/` for the protocol docs:

- `REVIEW-PROTOCOL.md`: "lone-slice review"→"lone-task review", "the slicer improver loop"→"the tasker improver loop", "the PRD's needs-attention reason"→"the brief's needs-attention reason", "a set of slices"→"a set of tasks", and the `uncertainSlices`/`decompositionUnclear` CHANNEL names updated to whatever the module-rename task settled them to (keep the doc and the code identical).
- `CLAIM-PROTOCOL.md`: the `work/briefs/ready/<prd>.md` placeholder → `<brief>`.
- `brief-template.md` / `task-template.md`: "slicing"→"tasking", "sliced"→"tasked", "vertical slice"→"vertical task" in the comments/prose.
- Skills `skills/*/SKILL.md` (`drive-tasks`, `orchestrate`, `review`, `to-brief`, `to-task`, `work`, `promote`, `setup`): replace slice/PRD/slicing prose with task/brief/tasking, keeping real historical slugs verbatim. (NOTE 2026-06-23: the conductor skill was renamed `drive-backlog` → `drive-tasks` in Phase 1 of this drive, and that skill's own prose + the cross-references in `orchestrate`/`work`/`promote`/`capture-signal` were ALREADY cut over to task/brief/tasking then — so the bulk of the skills-prose sweep may already be done; verify and only fix what remains. Do NOT look for a `drive-backlog` directory; it no longer exists.)

Keep `work/protocol/VERSION` bumped (any protocol-doc text change requires it). Keep source vs mirror byte-identical apart from VERSION.

## Acceptance criteria

- [ ] No active protocol doc or skill SKILL.md carries the retired verb "slicing"/"slicer" or the nouns "slice"/"PRD" as live vocabulary (real historical slugs and any deliberately-frozen tokens excepted, and called out where kept).
- [ ] `REVIEW-PROTOCOL.md` channel names match the renamed code identifiers exactly (doc-consistency test green).
- [ ] Source `skills/setup/protocol/` and mirror `work/protocol/` are byte-identical apart from VERSION; VERSION bumped.
- [ ] Any doc-consistency tests asserting the touched prose tokens are updated in this task; suite green.

## Blocked by

- `rename-protocol-doc-slicing-to-tasking` — shares the protocol-doc set + VERSION + the doc-consistency test machinery; serialize.

## Prompt

> Goal: finish the prose cutover — the remaining protocol docs (REVIEW/CLAIM/templates) and the skills SKILL.md files — to task/brief/tasking, per brief `code-identifier-slice-prd-to-task-brief-rename`. The high-traffic docs (WORK-CONTRACT, SURFACE, CONTEXT, TASKING-PROTOCOL) are already done; this mops up the rest.
>
> FIRST check reality (launch snapshot): confirm the channel names (`uncertainSlices`/`decompositionUnclear` or their renamed forms) match what the module-rename task settled, so the REVIEW doc and the code stay identical. If they diverge, that is the bug to fix here (or route to needs-attention if unclear).
>
> Where to look: `skills/setup/protocol/{REVIEW,CLAIM}-PROTOCOL.md` + `brief-template.md` + `task-template.md` (and their `work/protocol/` mirrors), and every `skills/*/SKILL.md`. Grep each for `slic`/`prd`/`PRD`. Keep real historical slugs (e.g. `*-slicing-*` filenames referenced as provenance) verbatim.
>
> Per AGENTS.md: edit the protocol SOURCE under `skills/setup/protocol/` and mirror into `work/protocol/`; bump VERSION; `diff -r` clean apart from VERSION.
>
> Done = build/test/format:check green, no retired vocabulary left in active docs/skills, doc-consistency tests green.

---

### Claiming this task

```sh
agent-runner claim rename-protocol-prose-and-skills-slicing-to-tasking --arbiter <remote>
git fetch <remote> && git switch -c work/rename-protocol-prose-and-skills-slicing-to-tasking <remote>/main
git mv work/tasks/todo/rename-protocol-prose-and-skills-slicing-to-tasking.md work/tasks/done/rename-protocol-prose-and-skills-slicing-to-tasking.md
```
