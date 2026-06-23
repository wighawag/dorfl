---
title: Complete the intake {slice,prd} -> {task,brief} cutover (artifact-type, verdict wire contract, flags) — finish Decision 2
slug: complete-intake-slice-prd-to-task-brief-cutover
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: [rename-advance-rung-and-sliced-outcome-tokens]
covers: []
---

> **AUTHORED 2026-06-23 (conductor + human, post-rename cleanup).** The brief's Decision 2 said the intake per-emitted-type `{slice, prd}` cutover to `{task, brief}` was in scope, but it was only PARTIALLY done: PR #209 renamed the per-type INTEGRATION map to `{task, brief}`, but the intake ARTIFACT-TYPE, the model-facing VERDICT OUTCOME union, the dispatch cases, the draft fields, and the CI intake FLAGS are all STILL `slice`/`prd`. This task finishes Decision 2 as a clean break. It is the one remaining `slice`/`prd` CODE surface, and it includes a model-facing WIRE CONTRACT (the intake verdict JSON the issue-intake model emits).

## What to build

Cut the intake front-door vocabulary over `{slice, prd}` -> `{task, brief}` (and `'sliced'`/`'prd'` outcomes -> `'tasked'`/`'briefed'`), CLEAN BREAK, no alias, per brief Decision 2. The emitted ARTIFACTS already land in `work/tasks/backlog/` (a task) and `work/briefs/ready/` (a brief) — only the intake CODE/wire words lag.

### The model-facing VERDICT wire contract (`intake.ts`)
- `IntakeOutcome = 'ask' | 'slice' | 'prd' | 'bounce'` (~L93) -> `'ask' | 'task' | 'brief' | 'bounce'`. This is what the intake MODEL emits in its verdict JSON; update the intake PROMPT builder text that instructs the model to emit `slice`/`prd`, and the verdict PARSER that reads them, IN THE SAME TASK (a wire contract: prompt + parser + type move together).
- The draft fields the verdict carries: `sliceSlug`/`sliceTitle`/`sliceBody` -> `taskSlug`/`taskTitle`/`taskBody`; `prdSlug`/`prdTitle` -> `briefSlug`/`briefTitle`. Update every reader (`verdict.sliceTitle ?? slug`, etc.).
- The `IntakeRunOutcome` arm `'prd'` (~L166) -> `'briefed'` and reconcile the `'sliced'`->`'tasked'` arm (done by the dependency task `rename-advance-rung-and-sliced-outcome-tokens`; if it landed, build on `'tasked'`; produce `outcome: kind === 'brief' ? 'briefed' : 'tasked'`).

### The artifact type + dispatch (`intake.ts`)
- `IntakeArtifactType = 'slice' | 'prd'` (~L377) -> `'task' | 'brief'`.
- The dispatch `switch (verdict.outcome)` cases `case 'slice':`/`case 'prd':` (~L818/L842) -> `'task'`/`'brief'`; rename `dispatchSlice` -> `dispatchTask` (and any `dispatchPrd`); the `kind: 'slice' | 'prd'` params (~L1348/L1445) and `kind === 'prd' ? 'PRD' : 'slice'` labels -> `'brief'`/`'task'`; the human-readable `artifact = kind === 'prd' ? 'PRD' : 'slice'` (~L1361) -> brief/task.

### The CI intake FLAGS (`cli.ts` + `intake-trigger-template.ts`)
- `--merge-prd`/`--propose-prd` -> `--merge-brief`/`--propose-brief`; `--merge-slice`/`--propose-slice` -> `--merge-task`/`--propose-task` (commander defs + help text in `cli.ts` ~L3347-3360; the `intake` command description ~L3323).
- `intake-trigger-template.ts`: the emitted workflow text + the policy-derivation comments + the validator regexes (`/--propose-slice\b/`, `/--merge-prd\b/`, etc., ~L501-519) + the `prd_flag`/`slice_flag` shell vars and the emitted `--propose-slice`/`--merge-prd` strings (~L243-363). Edit the EMITTER source, NEVER `.github/workflows/*` (a human regenerates CI via `install-ci`). Update the `IntakeIntegrationFlags` interface field names (`prd`/`slice` -> `brief`/`task`, ~L102-106) and their JSDoc.

### Tests
Update every asserting test (intake.test.ts, intake-integration-modes.test.ts, intake-lone-task-review.test.ts, intake-trigger-template.test.ts, and any verdict-parser/prompt test) in the SAME task.

## KEEP verbatim
Immutable historical slugs and any genuinely-frozen reference. This is a clean break: NO `slice`/`prd` alias, NO dual-read, NO deprecation warning (this repo has no external users owed a migration window — matches the namespace-token/config-key precedents).

## Acceptance criteria

- [ ] No live intake code or wire contract carries `slice`/`prd` as a current concept: `IntakeOutcome`/`IntakeArtifactType` are `{task,brief}`-vocabulary; the dispatch cases, `dispatchTask`, the draft fields (`taskSlug`/`taskTitle`/`taskBody`/`briefSlug`/`briefTitle`), and the `IntakeRunOutcome` (`'tasked'`/`'briefed'`) are renamed.
- [ ] The intake PROMPT instructs the model to emit `task`/`brief` outcomes and the PARSER reads them — prompt + parser + type renamed together (the wire contract is internally consistent).
- [ ] The CI intake flags are `--merge-task`/`--propose-task`/`--merge-brief`/`--propose-brief`; the old `--*-slice`/`--*-prd` are gone (no alias); `intake-trigger-template.ts` emits the new flags and its validators/tests assert them; NO `.github/workflows/*` edited.
- [ ] No back-compat alias / dual-read / deprecation warning (clean break).
- [ ] All asserting tests renamed in this task; `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- `rename-advance-rung-and-sliced-outcome-tokens` — both touch `intake.ts`'s outcome area; that task renames the `'sliced'` run-outcome arm, this one renames the `'prd'`/artifact-type cluster. Serialise so the outcome union settles cleanly.

## Prompt

> Goal: finish Decision 2 of brief `code-identifier-slice-prd-to-task-brief-rename` — cut the intake front-door `{slice,prd}` vocabulary over to `{task,brief}` (artifact-type, the model-facing verdict OUTCOME wire contract, the dispatch, the draft fields, the CI intake flags), CLEAN BREAK, no alias.
>
> FIRST verify reality: confirm `IntakeOutcome`/`IntakeArtifactType` are still `'slice'|'prd'` and the `--*-slice`/`--*-prd` flags still exist; confirm the dependency `rename-advance-rung-and-sliced-outcome-tokens` landed (so the `'sliced'`->`'tasked'` arm is settled) and build on its names. If anything already moved, reconcile.
>
> CRITICAL — this is a WIRE CONTRACT: the intake model emits `outcome` in its verdict JSON. The PROMPT builder (instructing the model), the verdict PARSER (reading it), and the `IntakeOutcome` type must change TOGETHER so the contract stays internally consistent. A clean break is fine (this repo's own CI is the only caller; regenerate CI via install-ci afterward).
>
> Where to look: `intake.ts` (IntakeOutcome/IntakeArtifactType/IntakeRunOutcome, the prompt builder, the verdict parser, the dispatch switch, dispatchSlice, the draft fields, the `kind` params/labels), `cli.ts` (the `intake` command flags + help), `intake-trigger-template.ts` (the emitted workflow flags + policy comments + validators + shell vars — EMITTER source only, never `.github/workflows/*`), and `index.ts` exports. Update all asserting tests. Run `pnpm format`.
>
> Done = build/test/format:check green, no `slice`/`prd` current-concept identifier left in the intake surface, the verdict wire contract internally consistent, the CI intake flags renamed in the emitter, no workflow file touched.

---

### Claiming this task

```sh
agent-runner claim complete-intake-slice-prd-to-task-brief-cutover --arbiter <remote>
git fetch <remote> && git switch -c work/complete-intake-slice-prd-to-task-brief-cutover <remote>/main
git mv work/tasks/todo/complete-intake-slice-prd-to-task-brief-cutover.md work/tasks/done/complete-intake-slice-prd-to-task-brief-cutover.md
```

## Requeue 2026-06-23

Gate-1 green (2585 tests) on the kept branch bc9ad67; Gate-2 hit the known 'review verdict was not valid JSON' parser crash (infra fault, not the work). Kept green tip pushed to origin work branch. Recover the stranded branch and open the PR; do NOT re-run the build.
