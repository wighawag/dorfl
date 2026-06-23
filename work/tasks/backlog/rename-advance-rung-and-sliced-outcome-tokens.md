---
title: Rename the advance rung tokens (build-slice/slice-prd) and the 'sliced' outcome token to tasking vocabulary
slug: rename-advance-rung-and-sliced-outcome-tokens
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: []
covers: []
---

> **AUTHORED 2026-06-23 (conductor + human, post-rename cleanup).** Two more live `slice`/`prd` CODE identifiers the original brief under-specified, surfaced during the rename drive (the rung tokens were noted in PR #215's review; the `'sliced'` outcome was deliberately left by the prose-only sweep). Clean break, no alias.

## What to build

### Rename 1 — the advance `TickRungKind` rung tokens

`advance-classify.ts` defines `TickRungKind` with rung tokens `'build-slice'` (the task-build rung) and `'slice-prd'` (the brief-tasking rung) — both still carry the old vocabulary though the verbs are now `do <slug>` (build a task) and `do brief:<slug>` (task a brief). Rename, clean break:

- `'build-slice'` → `'build-task'`
- `'slice-prd'` → `'task-brief'`

(Rationale: `'build-task'` = build a task; `'task-brief'` = task a brief — the verb-noun shape matching `do brief:`. Keep the sibling tokens `'triage-observation'`/`'surface'`/`'apply'` unchanged.)

Update the type (`advance-classify.ts` ~L73-79), the `ANALYSE_RUNG_FOR_TYPE` map (`task: 'build-slice'` → `'build-task'`, `brief: 'slice-prd'` → `'task-brief'`, ~L119-121), and every reader/`case`/`switch` across `advance.ts` (the `case 'build-slice':`/`case 'slice-prd':` at ~L998/1000), `advancing-lock.ts`, `advance-isolated.ts`, and `index.ts` (the `TickRungKind` export). Update the ~8 test files asserting these tokens.

### Rename 2 — the `'sliced'` run-outcome token

The shared run-OUTCOME value `'sliced'` (emitted by the tasking transition) still carries the old word. Rename `'sliced'` → `'tasked'`, clean break:

- `do.ts`: the outcome union member (~L132) + the `case 'sliced':` / `outcome = 'sliced'` (~L558-559).
- `tasking.ts`: the outcome union member (~L103), `commitTag: 'sliced'` (~L675), `outcome: 'sliced'` (~L756, L821).
- `intake.ts`: the `IntakeRunOutcome` member `'sliced'` (~L164) and `outcome: kind === 'prd' ? 'prd' : 'sliced'` (~L1398) — rename the `'sliced'` arm to `'tasked'`. (NOTE: the intake `'prd'` outcome + the `kind`/`IntakeArtifactType` `{slice,prd}` cluster is OWNED by the SEPARATE task `complete-intake-slice-prd-to-task-brief-cutover`; here touch ONLY the `'sliced'` → `'tasked'` arm, leaving `'prd'`/`kind` for that task. If that task has already landed, reconcile to its settled names instead.)

Update the ~15 test files asserting `'sliced'`.

## OUT OF SCOPE

- The intake `{slice,prd}` artifact-type / `IntakeOutcome` `'slice'`/`'prd'` / the `sliceSlug`/`prdSlug` fields / the `--propose-slice`/`--propose-prd` flags — all owned by `complete-intake-slice-prd-to-task-brief-cutover`. Touch ONLY the `'sliced'` run-outcome arm in `intake.ts`.
- Free-prose comments beyond what these token renames require (the broad prose sweep already landed).

## Acceptance criteria

- [ ] `TickRungKind` tokens are `'build-task'` / `'task-brief'` (no `'build-slice'`/`'slice-prd'` anywhere live); the `ANALYSE_RUNG_FOR_TYPE` map + every `case`/reader updated; the `index.ts` export still re-exports the type.
- [ ] The run-outcome token is `'tasked'` (no `'sliced'` in `do.ts`/`tasking.ts`/`intake.ts` live code), EXCEPT the intake `'prd'`/`kind` cluster which is left for the intake task.
- [ ] No back-compat alias for either token (clean break).
- [ ] All asserting tests renamed in this task; `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None — startable immediately. (Serialise BEFORE `complete-intake-slice-prd-to-task-brief-cutover` if convenient, since both touch `intake.ts`'s outcome area; the scope fence above keeps them disjoint, but building this first avoids churn.)

## Prompt

> Goal: rename two residual `slice`/`prd` CODE tokens to tasking vocabulary, clean break, per brief `code-identifier-slice-prd-to-task-brief-rename`: the advance `TickRungKind` rung tokens `'build-slice'`→`'build-task'` / `'slice-prd'`→`'task-brief'`, and the run-outcome `'sliced'`→`'tasked'`.
>
> FIRST verify reality: confirm `TickRungKind` still has `'build-slice'`/`'slice-prd'` (`advance-classify.ts`) and the outcome union still has `'sliced'` (`do.ts`/`tasking.ts`/`intake.ts`). If already renamed, reconcile.
>
> Where to look: `advance-classify.ts` (type + `ANALYSE_RUNG_FOR_TYPE`), `advance.ts`/`advancing-lock.ts`/`advance-isolated.ts`/`index.ts` (readers/exports), and `do.ts`/`tasking.ts`/`intake.ts` (the `'sliced'` outcome). Update the asserting tests in the same task.
>
> SCOPE FENCE: do NOT touch the intake `{slice,prd}` artifact-type / `IntakeOutcome` `'slice'`/`'prd'` / `sliceSlug`/`prdSlug` / `--propose-slice`/`--propose-prd` — those are owned by `complete-intake-slice-prd-to-task-brief-cutover`. Here, in `intake.ts`, change ONLY the `'sliced'` run-outcome arm to `'tasked'`.
>
> Done = build/test/format:check green, both token sets renamed clean, the intake artifact-type cluster untouched.

---

### Claiming this task

```sh
agent-runner claim rename-advance-rung-and-sliced-outcome-tokens --arbiter <remote>
git fetch <remote> && git switch -c work/rename-advance-rung-and-sliced-outcome-tokens <remote>/main
git mv work/tasks/todo/rename-advance-rung-and-sliced-outcome-tokens.md work/tasks/done/rename-advance-rung-and-sliced-outcome-tokens.md
```
