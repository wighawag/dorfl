---
title: drive-tasks opt-in-backlog mode dispatches --allow-backlog
slug: drive-tasks-dispatch-allow-backlog
prd: do-allow-backlog-drive-staged-tasks-without-promotion
blockedBy: [do-allow-backlog-flag-resolver-claim-and-done-move]
covers: [5]
---

## What to build

Make `drive-tasks`'s opt-in-backlog mode actually work by dispatching
`--allow-backlog`, and state the rationale so a reader chooses drive-in-place
over promote-then-drive.

End-to-end behaviour (skill-doc only):

- The `drive-tasks` skill's "Opt-in: drive tasks from `tasks/backlog/`" mode
  currently dispatches `dorfl do task:<slug> --isolated` against a staged slug —
  which throws today (`resolveTask` doesn't search `tasks-backlog`). Update the
  mode to dispatch `dorfl do task:<slug> --isolated --allow-backlog`, so the
  documented mode actually builds staged tasks.
- Add a short rationale: drive-in-place beats promote-then-drive because
  promoting `backlog → ready` exposes the task to the agent pool (CI `advance` /
  a local `run` daemon both claim from `tasks-ready`), opening a competition
  window; `--allow-backlog` keeps the human in sole control of the set they are
  driving.

## Acceptance criteria

- [ ] The opt-in-backlog mode dispatches `do ... --allow-backlog` (so it no
      longer throws on a staged slug).
- [ ] The skill states WHY drive-in-place beats promote-then-drive (the
      competition window), pointing at the flag.
- [ ] Skill-doc only; no code change.

## Blocked by

- `do-allow-backlog-flag-resolver-claim-and-done-move` — the flag must exist for
  the skill to dispatch it (otherwise the instruction references a non-existent
  flag).

## Prompt

> Goal: wire `drive-tasks`'s opt-in-backlog mode to the new `--allow-backlog`
> flag, per the PRD `do-allow-backlog-drive-staged-tasks-without-promotion`
> (US #5, Resolved decision 6 — the mode is a spec without a mechanism today).
>
> Where to look: the `drive-tasks` SKILL.md section "Opt-in: drive tasks from
> `tasks/backlog/`" (it dispatches `do ... --isolated`). Change the dispatch to
> add `--allow-backlog`, and add the drive-in-place-beats-promote-then-drive
> rationale (the competition window: promoting to `ready/` exposes the task to
> CI `advance` / a local `run` daemon).
>
> Note: `drive-tasks` is a user-scoped operator skill (under the agents skills
> dir), NOT a protocol doc — there is no source/mirror pair to keep in sync here
> (unlike WORK-CONTRACT.md). Edit the one skill file.
