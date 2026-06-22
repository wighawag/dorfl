---
title: Rename config keys (slicingIntegration/slicesLandIn/prdsLandIn/autoSlice/intake {slice,prd}) to tasking vocabulary
slug: rename-config-keys-slicing-to-tasking
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: []
covers: []
---

## What to build

Rename the `.agent-runner.json` config keys carrying the retired vocabulary, as a CLEAN BREAK with NO read-old alias (Decision 2). NOTE the two land-in surfaces are DISTINCT (verified against `cli.ts`) — do not conflate them:

- `slicingIntegration` → `taskingIntegration`
- `slicesLandIn` (the TASK-side placement; current values `pre-backlog`/`todo`) → `tasksLandIn`, KEEPING its current values `pre-backlog`/`todo` (the pool value was already migrated `backlog`→`todo` by task `f1-pool-noun-todo-in-surface-and-apply-readers`; do NOT reintroduce `prd` values here).
- the BRIEF-side placement config (the `prdsLandIn` sibling of `slicesLandIn`, whose `--prds-land-in` flag takes `pre-prd`/`prd`) → `briefsLandIn` with values `pre-ready`/`ready`... BUT see the pool-name caveat below.
- `autoSlice` → `autoTask`
- intake's per-emitted-type `{slice, prd}` (`intake.ts`) → `{task, brief}`

**Pool-name caveat (load-bearing):** the brief pool folder on disk is `work/briefs/ready/` (the `tasks/todo/`→`tasks/ready/` rename is DESIRED but NOT yet implemented — the task pool is still `todo`). So the brief-side value spelling should reflect the LIVE brief folders (`proposed`/`ready`), and the task-side value spelling the LIVE task folders (`backlog`/`todo`). Match the values to whatever the folders actually are AT TASK TIME; record the exact spellings you chose.

**Existing `backlog` alias shim (Decision):** `--slices-land-in 'backlog'` currently has a live deprecation shim (warn + treat as `todo`). Decide explicitly: REMOVE the shim as part of this clean-break rename (preferred — it was a transitional aid), and delete its test. State the choice in the done record.

**This repo's own config (Decision 2 consequence):** `agent-runner`'s own `.agent-runner.json` sets `autoSlice: true`. Because the cutover is a clean break (an unknown key is silently ignored), you MUST migrate this repo's own config key (`autoSlice` → `autoTask`) in the SAME change, or this repo silently loses auto-tasking.

Update the config parser/resolver, every reader, the env-var layer if any sibling exists, the precedence resolution, this repo's `.agent-runner.json`, and all tests asserting the old keys (in the SAME task).

## Acceptance criteria

- [ ] No live code reads or writes `slicingIntegration` / `slicesLandIn` / the brief-side `prdsLandIn` / `autoSlice` / intake `{slice, prd}`; the live keys are the tasking-vocabulary names above, with the TWO land-in surfaces kept distinct.
- [ ] The land-in VALUES match the live folder names (task-side `pre-backlog`/`todo`; brief-side `proposed`/`ready` spelling), NOT a not-yet-implemented pool name; the chosen spellings are recorded.
- [ ] The existing `--slices-land-in 'backlog'` deprecation shim is removed (with its test), per the clean-break decision.
- [ ] This repo's `.agent-runner.json` is migrated (`autoSlice` → `autoTask`); auto-tasking still resolves on for this repo.
- [ ] No back-compat alias and no deprecation warning for the RENAMED keys (clean break — an unknown old key is simply ignored).
- [ ] The precedence chains (flag > env > per-repo > global > default) resolve identically under the new names; the maintainer's `taskingIntegration` split behaviour is preserved.
- [ ] Tests assert the new keys (renamed in this task); suite green.

## Blocked by

- None. (Originally `blockedBy: [rename-lock-cli-namespace-tokens-prd-slice-to-brief-task]` to serialize the shared `cli.ts`/config-resolution surface, but that task was CANCELLED as superseded by PR #179 on 2026-06-22 — its token cutover already landed — so this is now startable. See the cancelled task's body.)

## Prompt

> Goal: rename the retired-vocabulary config keys to tasking names as a CLEAN BREAK (no alias), per brief `code-identifier-slice-prd-to-task-brief-rename` Decision 2.
>
> FIRST verify the current config shape against reality (launch snapshot): confirm these keys still exist with these meanings and resolution precedence before renaming. If the config model drifted, route to needs-attention.
>
> Where to look: the config schema/parser + resolver (`config.ts`), `do-config`, the env-config layer, the intake per-emitted-type integration resolver (`intake.ts` `{slice, prd}`), the per-transition `taskingIntegration ?? integration` threading site, the TWO land-in resolvers in `cli.ts` (`--slices-land-in` task-side with `pre-backlog`/`todo` + the `backlog` shim; `--prds-land-in` brief-side with `pre-prd`/`prd`), and this repo's `.agent-runner.json`. Search for each literal key string.
>
> CRITICAL: the task-side (`slicesLandIn`) and brief-side (`prdsLandIn`) placement surfaces are DISTINCT with DIFFERENT value sets — do not merge them. Match each one's VALUES to the LIVE folder names (the `todo`→`ready` task-pool rename is not yet implemented, so task pool is still `todo`; the brief pool is already `ready`). Remove the existing `backlog`-alias shim per the clean break. Migrate THIS repo's `.agent-runner.json` (`autoSlice`→`autoTask`) in the same change.
>
> Done = build/test/format:check green, old keys gone from live code, both land-in surfaces renamed distinctly with live-folder values, the `backlog` shim removed, this repo's config migrated, precedence behaviour unchanged. Record the chosen value spellings. Honour the dependency: start only after the namespace-token task has landed.

---

### Claiming this task

```sh
agent-runner claim rename-config-keys-slicing-to-tasking --arbiter <remote>
git fetch <remote> && git switch -c work/rename-config-keys-slicing-to-tasking <remote>/main
git mv work/tasks/todo/rename-config-keys-slicing-to-tasking.md work/tasks/done/rename-config-keys-slicing-to-tasking.md
```

## Requeue 2026-06-22

Gate-2 review verdict crashed with a JSON parse error (verdict not valid JSON at position 8101) AFTER a fully GREEN Gate-1 build (2585 tests). Infra/gate fault, not the work. Kept branch pushed to origin. Continue from it; just re-run gate + Gate-2.
