---
title: Rename CLI verb + flags (do prd: -> do brief:, --prds-land-in, --slicer-loop*) to tasking vocabulary
slug: rename-cli-verb-and-flags-do-prd-to-do-brief
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: [rename-config-keys-slicing-to-tasking]
covers: []
---

## What to build

Rename the operator-facing CLI surface as a CLEAN BREAK (Decision 3):

- `do prd:<slug>` → `do brief:<slug>` (the tasking-transition invocation)
- `--prds-land-in` → `--briefs-land-in`
- `--slicer-loop` / `--no-slicer-loop` / `--slicer-loop-max` / `--slicer-loop-model` → `--tasker-loop*`

Update the commander wiring, help text, the arg validation/rejection messages (e.g. "operates on tasks, not briefs"), and every test asserting the old verb/flag spellings (in the SAME task).

## Acceptance criteria

- [ ] `do brief:<slug>` is the live verb; `do prd:<slug>` is no longer accepted (clean break).
- [ ] `--briefs-land-in` and `--tasker-loop*` are the live flags; the old spellings are gone (not aliased).
- [ ] Help text + validation/rejection messages use task/brief/tasking vocabulary.
- [ ] Tests assert the new verb/flags (renamed in this task); suite green.

## Blocked by

- `rename-config-keys-slicing-to-tasking` — shares `cli.ts`; the flags resolve into the renamed config keys, so this must follow.

## Prompt

> Goal: cut the operator-facing CLI verb + flags over to tasking vocabulary as a CLEAN BREAK, per brief `code-identifier-slice-prd-to-task-brief-rename` Decision 3.
>
> FIRST check against reality (launch snapshot): confirm the verb-namespace parsing and these flag names still exist as assumed; the flags must resolve into the ALREADY-renamed config keys from the blocking task. If the CLI surface drifted, route to needs-attention.
>
> Where to look: the commander command/option definitions (`cli.ts`), the verb-namespace resolver that accepts bare + `brief:`/`task:` and rejects the wrong namespace, the help/usage strings, and the flag→config-key resolution.
>
> Done = build/test/format:check green, `do brief:` live, old verb/flags gone. Honour the dependency on the config-key task.

---

### Claiming this task

```sh
agent-runner claim rename-cli-verb-and-flags-do-prd-to-do-brief --arbiter <remote>
git fetch <remote> && git switch -c work/rename-cli-verb-and-flags-do-prd-to-do-brief <remote>/main
git mv work/tasks/todo/rename-cli-verb-and-flags-do-prd-to-do-brief.md work/tasks/done/rename-cli-verb-and-flags-do-prd-to-do-brief.md
```
