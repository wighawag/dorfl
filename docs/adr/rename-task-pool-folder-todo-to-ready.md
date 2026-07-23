---
title: 'Rename the claimable task pool folder `tasks/todo/` → `tasks/ready/`'
status: accepted
created: 2026-06-24
decided: 2026-06-24
supersedes:
superseded_by:
---

# ADR: rename the agent task POOL folder `tasks/todo/` → `tasks/ready/`

## Context

The task lifecycle board is `tasks/backlog/` (STAGING, not yet admitted) →
`tasks/todo/` (the agent POOL, claimable) → `tasks/done/` / `tasks/cancelled/`.
The pool folder was named `todo`. The observation
`task-pool-folder-named-todo-is-less-precise-than-ready-2026-06-20` (and its open
question) flagged that `todo` is the loosest everyday reading for what is actually
a vetted, committed, claimable pool: the Kanban `Ready` sense. A reader carrying
the fuzzier "loose to-do list" model can misread a `tasks/todo/` item as a note
rather than a claimable item, the exact inversion the naming invites.

The SPEC-side already names its auto-task pool `specs/ready/` and its placement value
`'ready'`. The task side using `todo` made the two regimes gratuitously asymmetric.

## Decision

Rename the task POOL end-to-end to `ready`, as a CLEAN BREAK (no backward
compatibility, no deprecation shim — explicit maintainer instruction):

1. **On-disk folder**: `work/tasks/todo/` → `work/tasks/ready/` (`git mv`).
2. **`work-layout` registry**: the `WORK_FOLDER_NAME` value `'tasks/todo'` →
   `'tasks/ready'`, and the SYMBOLIC KEY `'tasks-todo'` → `'tasks-ready'`
   (the registry deliberately keeps keys in the live vocabulary). Every call site
   references the key, so the path flip is centralised here.
3. **Internal ledger shape**: `LocalLedgerState.todo` → `.ready`,
   `LedgerTodoItem` → `LedgerReadyItem`, `readLocalTodo` → `readLocalReady`,
   `scan.TodoItem` alias → `ReadyItem`, so the pool noun is coherent in the code.
4. **Config placement VALUE**: `tasksLandIn`'s pool value `'todo'` → `'ready'`.
   The CLI flag `--tasks-land-in`, the env enum (`DORFL_TASKS_LAND_IN`),
   and the `TasksLandIn` type all take `'pre-backlog' | 'ready'`. CLEAN BREAK: the
   old `'todo'` spelling is NOT accepted (no shim, no warning). The task-side now
   mirrors the spec-side `'ready'` pool value spelling.
5. **Protocol docs** (both copies, kept byte-identical per AGENTS.md):
   `skills/setup/protocol/*` SOURCE + `work/protocol/*` propagated copy.
6. **Skills, CONTEXT.md, ADR prose, tests**: every reference to the pool as
   `todo` updated to `ready`.

## Consequences

- The folder-as-status state machine is unchanged in SHAPE; only the pool noun
  changes. `blockedBy` / dependency resolution against `done/` is untouched.
- A clean break means an existing repo with `tasksLandIn: 'todo'` (or
  `--tasks-land-in todo`) now hard-errors at config-validation / flag-parse time
  instead of silently working. This is intended: there is no production fleet to
  migrate, and a hard error is more honest than a silent alias.
- `backlog` keeps meaning STAGING (`tasks/backlog/`); only the POOL noun moved.

## Provenance

- Observation `work/notes/observations/task-pool-folder-named-todo-is-less-precise-than-ready-2026-06-20.md`
  (Tier-2 option) + its open question.
- Kanban-convention check recorded in that observation (six sources, 2026-06-20):
  `Ready` is the most cross-source-agreed term for the committed/pull-when-ready slot.
