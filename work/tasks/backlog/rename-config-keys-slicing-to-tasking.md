---
title: Rename config keys (slicingIntegration/slicesLandIn/autoSlice/intake {slice,prd}) to tasking vocabulary
slug: rename-config-keys-slicing-to-tasking
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: [rename-lock-cli-namespace-tokens-prd-slice-to-brief-task]
covers: []
---

## What to build

Rename the `.agent-runner.json` config keys carrying the retired vocabulary, as a CLEAN BREAK with NO read-old alias (Decision 2):

- `slicingIntegration` → `taskingIntegration`
- `slicesLandIn` → `tasksLandIn`, and its values `pre-prd`/`prd` → the spelling that matches the live folder vocabulary at task time (`backlog`/`todo`, i.e. staging/pool)
- `autoSlice` → `autoTask`
- intake's per-emitted-type `{slice, prd}` → `{task, brief}`

Update the config parser/resolver, every reader, the env-var layer if any sibling exists, the precedence resolution, and all tests asserting the old keys (in the SAME task).

## Acceptance criteria

- [ ] No live code reads or writes `slicingIntegration` / `slicesLandIn` / `autoSlice` / intake `{slice, prd}`; the live keys are the tasking-vocabulary names above.
- [ ] No back-compat alias and no deprecation warning for the old keys (clean break — an old key in a config is simply unknown).
- [ ] The precedence chains (flag > env > per-repo > global > default) resolve identically under the new names; the maintainer's `taskingIntegration` split behaviour is preserved.
- [ ] Tests assert the new keys (renamed in this task); suite green.

## Blocked by

- `rename-lock-cli-namespace-tokens-prd-slice-to-brief-task` — shares `cli.ts`/config-resolution surface; serialize to avoid merge conflicts.

## Prompt

> Goal: rename the retired-vocabulary config keys to tasking names as a CLEAN BREAK (no alias), per brief `code-identifier-slice-prd-to-task-brief-rename` Decision 2.
>
> FIRST verify the current config shape against reality (launch snapshot): confirm these keys still exist with these meanings and resolution precedence before renaming. If the config model drifted, route to needs-attention.
>
> Where to look: the config schema/parser + resolver, `do-config`, the env-config layer, the intake per-emitted-type integration resolver, and the per-transition `taskingIntegration ?? integration` threading site. Search for each literal key string.
>
> Done = build/test/format:check green, old keys gone from live code, precedence behaviour unchanged. Pick the `tasksLandIn` value spelling to MATCH the live folder names (`backlog`/`todo`) and record that choice. Honour the dependency: start only after the namespace-token task has landed.

---

### Claiming this task

```sh
agent-runner claim rename-config-keys-slicing-to-tasking --arbiter <remote>
git fetch <remote> && git switch -c work/rename-config-keys-slicing-to-tasking <remote>/main
git mv work/tasks/todo/rename-config-keys-slicing-to-tasking.md work/tasks/done/rename-config-keys-slicing-to-tasking.md
```
