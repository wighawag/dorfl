---
title: Cut remaining protocol-doc prose + skills SKILL.md over to task/brief/tasking vocabulary
slug: rename-protocol-prose-and-skills-slicing-to-tasking
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: [rename-protocol-doc-slicing-to-tasking]
covers: []
---

## What to build

Sweep the remaining retired-vocabulary PROSE out of the protocol docs (other than the already-renamed TASKING-PROTOCOL.md) and the skills, mirroring source→`work/protocol/` for the protocol docs:

- `REVIEW-PROTOCOL.md`: "lone-slice review"→"lone-task review", "the slicer improver loop"→"the tasker improver loop", "the SPEC's needs-attention reason"→"the brief's needs-attention reason", "a set of slices"→"a set of tasks", and the `uncertainSlices`/`decompositionUnclear` CHANNEL names updated to whatever the module-rename task settled them to (keep the doc and the code identical).
- `CLAIM-PROTOCOL.md`: the `work/briefs/ready/<spec>.md` placeholder → `<brief>`.
- `brief-template.md` / `task-template.md`: "slicing"→"tasking", "sliced"→"tasked", "vertical slice"→"vertical task" in the comments/prose.
- Skills `skills/*/SKILL.md` (`drive-tasks`, `orchestrate`, `review`, `to-brief`, `to-task`, `work`, `promote`, `setup`): replace slice/SPEC/slicing prose with task/brief/tasking, keeping real historical slugs verbatim. (NOTE 2026-06-23: the conductor skill was renamed `drive-backlog` → `drive-tasks` in Phase 1 of this drive, and that skill's own prose + the cross-references in `orchestrate`/`work`/`promote`/`capture-signal` were ALREADY cut over to task/brief/tasking then — so the bulk of the skills-prose sweep may already be done; verify and only fix what remains. Do NOT look for a `drive-backlog` directory; it no longer exists.)

Keep `work/protocol/VERSION` bumped (any protocol-doc text change requires it). Keep source vs mirror byte-identical apart from VERSION.

> **SCOPE NARROWED 2026-06-23 (decided conductor + human, during the `drive-tasks` drive).** The original criterion #1 was GLOBAL ("No active protocol doc OR skill SKILL.md carries the retired vocabulary"), but that is UNSATISFIABLE within this task's "What to build" file list: `WORK-CONTRACT.md` (~38 occurrences) and `SURFACE-PROTOCOL.md` (line 115 "slicing/reviewing judgement") carry the retired vocabulary, are NOT in this task's file list, and were not touched by any prior task (task `rename-docs-prose-slicing-to-tasking` covered `docs/` only). Worse, `WORK-CONTRACT.md`'s `slic*` prose is ENTANGLED with still-live CODE identifiers owned by no current task — the lock action token `'slice'` (`LockAction = 'implement' | 'slice' | 'advance'` in `item-lock.ts`; `action: 'slice'` in `tasking-lock.ts`) and the residual `--slices-land-in` flag in `cli.ts` — so its `action: slice` / `--slices-land-in` prose currently MATCHES live code; rewriting it would get AHEAD of those code renames (a cross-task decision). Therefore criterion #1 is NARROWED below to ONLY this task's listed files, and `WORK-CONTRACT.md` + `SURFACE-PROTOCOL.md` are carved into the follow-up task `rename-protocol-prose-workcontract-and-surface-slicing-to-tasking`, which is sequenced AFTER a lock-action/CLI-flag code rename (see the observation `residual-slice-code-identifiers-lock-action-and-slices-land-in-flag`).

## Acceptance criteria (NARROWED — only this task's listed files; WORK-CONTRACT/SURFACE carved to a follow-up)

- [ ] None of THIS TASK'S LISTED files — `REVIEW-PROTOCOL.md`, `CLAIM-PROTOCOL.md`, `brief-template.md`, `task-template.md` (source + `work/protocol/` mirror), and every `skills/*/SKILL.md` — carries the retired verb "slicing"/"slicer" or the nouns "slice"/"SPEC" as live CURRENT-CONCEPT vocabulary (real historical slugs, the intake `{slice,spec}` wire vocabulary, and the still-live `action: 'slice'` lock token excepted, and called out where kept).
- [ ] EXPLICITLY OUT OF SCOPE (deferred to the follow-up `rename-protocol-prose-workcontract-and-surface-slicing-to-tasking`): `WORK-CONTRACT.md` and `SURFACE-PROTOCOL.md`. Do NOT edit them here; a reviewer must NOT block this task on residue in those two files.
- [ ] `REVIEW-PROTOCOL.md` channel names match the renamed code identifiers exactly — already settled on `uncertainTasks` + `decompositionUnclear` in code (doc-consistency test green).
- [ ] Source `skills/setup/protocol/` and mirror `work/protocol/` are byte-identical apart from VERSION; VERSION bumped.
- [ ] Any doc-consistency tests asserting the touched prose tokens are updated in this task; suite green.

## Blocked by

- `rename-protocol-doc-slicing-to-tasking` — shares the protocol-doc set + VERSION + the doc-consistency test machinery; serialize. (DONE.)

## Prompt

> Goal: finish the prose cutover for THIS TASK'S FILES — the protocol docs `REVIEW-PROTOCOL.md` + `CLAIM-PROTOCOL.md` + `brief-template.md` + `task-template.md` and every `skills/*/SKILL.md` — to task/brief/tasking, per brief `code-identifier-slice-prd-to-task-brief-rename`. CONTEXT and TASKING-PROTOCOL are already done. SCOPE NOTE (corrected 2026-06-23): `WORK-CONTRACT.md` and `SURFACE-PROTOCOL.md` are NOT yet done and are EXPLICITLY OUT OF SCOPE here (their `slic*` prose is entangled with the still-live `action: 'slice'` lock token + `--slices-land-in` flag, so they wait for a code rename + the follow-up task `rename-protocol-prose-workcontract-and-surface-slicing-to-tasking`). Do NOT touch them; do NOT treat residue in them as your failure.
>
> FIRST check reality (launch snapshot): confirm the channel names (`uncertainSlices`/`decompositionUnclear` or their renamed forms) match what the module-rename task settled, so the REVIEW doc and the code stay identical. If they diverge, that is the bug to fix here (or route to needs-attention if unclear).
>
> Where to look: `skills/setup/protocol/{REVIEW,CLAIM}-PROTOCOL.md` + `brief-template.md` + `task-template.md` (and their `work/protocol/` mirrors), and every `skills/*/SKILL.md`. Grep each for `slic`/`spec`/`SPEC`. Keep real historical slugs (e.g. `*-slicing-*` filenames referenced as provenance) verbatim.
>
> Per AGENTS.md: edit the protocol SOURCE under `skills/setup/protocol/` and mirror into `work/protocol/`; bump VERSION; `diff -r` clean apart from VERSION.
>
> Done = build/test/format:check green, no retired vocabulary left in active docs/skills, doc-consistency tests green.

---

### Claiming this task

```sh
dorfl claim rename-protocol-prose-and-skills-slicing-to-tasking --arbiter <remote>
git fetch <remote> && git switch -c work/rename-protocol-prose-and-skills-slicing-to-tasking <remote>/main
git mv work/tasks/todo/rename-protocol-prose-and-skills-slicing-to-tasking.md work/tasks/done/rename-protocol-prose-and-skills-slicing-to-tasking.md
```

## Requeue 2026-06-23

Gate-2 BLOCK fix (small, literal, continue from kept branch): two stale autoSlice references remain (autoSlice was renamed to autoTask in PR #209; it no longer exists in code, and is NOT on this task's keep-list). Fix exactly: (1) skills/setup/SKILL.md line 247 in the dorfl.json template: "autoSlice": false -> "autoTask": false; (2) skills/setup/SKILL.md line ~254 prose: 'autoBuild / autoSlice — strict-by-default' -> 'autoBuild / autoTask'; (3) skills/orchestrate/SKILL.md line 54: 'gate-gated by autoSlice' -> 'gate-gated by autoTask'. Keep everything else from your branch. Re-verify: grep -rn 'autoSlice' skills/ returns nothing. Then re-run the gate.

## Requeue 2026-06-23

Gate-2 verdict JSON-parse crash (position 5758) AFTER green Gate-1 (2585 tests) and AFTER the 3 autoSlice->autoTask fixes were applied (verified 0 autoSlice in setup/orchestrate SKILL.md on the kept branch). Recurring infra/gate fault, not the work. Continue from the kept branch; re-run gate + Gate-2.
