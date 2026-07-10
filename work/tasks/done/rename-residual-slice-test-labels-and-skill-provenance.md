---
title: Tidy residual slice/spec test labels + fixtures + make skill prose self-sufficient (no done-task provenance)
slug: rename-residual-slice-test-labels-and-skill-provenance
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: [rename-selection-pool-slice-keyword-to-task]
covers: []
---

> **AUTHORED 2026-06-23 (conductor + human, post-rename cleanup follow-up).** Three small residual-`slice` clusters the human spotted reviewing the remaining hits: (1) stale test LABELS/comments naming a now-renamed identifier, (2) clear current-concept test FIXTURES + stale describe-string prose (the deferred Gate-2 nit from `fix-scan-json-brief-pool-jq-and-close-job-via`), (3) skill prose that cites a DONE TASK as the reason it is shaped that way (a skill should be self-sufficient — state the rule, not the historical anecdote). Clean break. Blocked on the `SelectionPool` keyword task only so the `build/task/...` pool spelling is settled before this touches any selection-order test prose.

## What to build

### 1. Stale test labels/comments where the real identifier ALREADY renamed
- `test/review-protocol-doc.test.ts` (~L178, L182): the `name:` string labels `'buildSliceAcceptancePrompt'` / `'buildSliceReviewPrompt'` describe builders that are ALREADY called as `buildTaskAcceptancePrompt` / `buildTaskReviewPrompt` in the same object. Rename the labels to match the real function names. (LEAVE `buildLoneSliceReviewPrompt` at ~L193 — `LoneSlice` is a LIVE src identifier in `review-verdict.ts`/`intake.ts`, NOT in scope.)
- `test/advance-release-crash-safe.test.ts` (~L97): the JSDoc comment says "a `RungExecutor` whose `buildSlice` simulates …" but the live `RungExecutor` property is `buildTask` (`advance.ts` L135/407/999). Fix the comment `buildSlice` -> `buildTask`.
- `test/intake.test.ts` (~L799 `sliceProvider`, ~L1327 `prdOnMain`): test-local variable names carrying the old vocabulary for current concepts (a task-emit issue-provider stub; a brief-on-main assertion). Rename `sliceProvider` -> `taskProvider` (it stubs the task-emit path) and `prdOnMain` -> `briefOnMain`. Rename every in-scope use of each var.

### 2. Clear current-concept test fixtures + stale describe-string prose
- `test/scan.test.ts` (~L391, L416, L485, L501): the describe-block / comment PROSE still says `sliceable-SPEC pool (\`specs[]\`)` and "reads BOTH `items[]` AND `specs[]`". The key is now `briefs[]` (landed in `fix-scan-json-brief-pool-jq-and-close-job-via`) — update the prose to `taskable-brief pool (\`briefs[]\`)` / `briefs[]`. (This is the deferred residual that task's Gate-2 nit named.)
- `test/close-job.test.ts` (~L115-140): the test NAMES say "closes the SPEC issue when ALL its `prd:<slug>` slices are in work/tasks/done/" and the fixture slug is `my-spec`. Rename the test names to brief/task vocabulary ("closes the brief's issue when ALL its tasks are in work/tasks/done/") and the fixture `my-spec` -> `my-brief` (update the `brief: 'my-spec'` refs + the `toContain('my-spec')` assertion together).
- `test/workspace.test.ts` (~L36) fixture slug `'my-slice'` -> `'my-task'` (an arbitrary work-id-encoding fixture; the concept it stands for is a task).
- `test/setup-prompt-guidance-question.test.ts` (~L135, L156) fixture `'my-spec'` -> `'my-brief'`.
- `test/surface-blockers-gate.test.ts` (~L195) fixture `'blocked-spec'` -> `'blocked-brief'` (+ its `seedBlockedBrief` call site).
- `test/task-acceptance-gate.test.ts` (~L44) the temp-dir prefix `'dorfl-slice-gate-'` -> `'dorfl-task-gate-'`.

### 3. Skill prose — self-sufficient, no done-task provenance
- `skills/drive-tasks/SKILL.md` (~L74): DELETE the anecdote "(This session fixed the `slicer-review-edit-loop` task exactly this way: …)" — keep the RULE (requeue + re-do continues from the kept branch), drop the historical session anecdote. The skill states what to do, not which past task did it.
- `skills/drive-tasks/SKILL.md` (~L153): the Gate-3 re-verify paragraph cites "(task `gate-on-rebased-tip-fresh-worktree`, ON by default)" and "subsumes `work/notes/observations/…`" as the REASON. Reframe to state the behaviour self-sufficiently (the `freshWorktreeGate` config runs prepare+verify in a clean rebased worktree) WITHOUT the task-slug / observation-path provenance. Keep the `--no-fresh-worktree-gate` opt-out fact.
- Scan the other skills for the same pattern only if it is a current-concept `slice`/`spec` provenance citation; do NOT broaden into unrelated prose.

## OUT OF SCOPE
- The `slug-namespace.test.ts` `writeItem(folder: 'spec' | 'spec-sliced')` old-vocabulary FOLDER names and any other fixture-FOLDER-word usage — owned by `clean-break-fixture-folder-vocab-compat-seam` (the `helpers/gitRepo.ts` compat-seam task).
- `LoneSlice`/`reviewSlice`/`LoneSliceReviewGate` — LIVE src identifiers (lone-task-review cluster), a separate future rename, NOT here.
- The `SelectionPool` keyword — owned by `rename-selection-pool-slice-keyword-to-task` (the dependency).
- Immutable historical slugs (`slicer-review-edit-loop` if referenced purely as a slug elsewhere, `gate-on-rebased-tip-fresh-worktree` as a slug) — only the PROSE that cites them as provenance is reframed; do not rewrite a genuine slug token used as an identifier.

## Acceptance criteria

- [ ] No stale test label/comment names a renamed identifier with the old word (`buildSlice*` labels, the `buildSlice` `RungExecutor` comment, `sliceProvider`/`prdOnMain` vars are renamed); `buildLoneSliceReviewPrompt` left intact.
- [ ] The `scan.test.ts` / `close-job.test.ts` describe-string + test-name prose and fixtures (`my-spec`) read task/brief vocabulary; the `my-slice`/`my-spec`/`blocked-spec`/`slice-gate` fixtures renamed.
- [ ] `skills/drive-tasks/SKILL.md` reads self-sufficiently: no done-task anecdote/provenance as the REASON (the rule stands on its own); behaviour facts preserved.
- [ ] No change to `slug-namespace.test.ts` fixture folders, `LoneSlice*`, or the `SelectionPool` keyword (scope fences honoured).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green; no `.github/workflows/*` edited.

## Blocked by

- `rename-selection-pool-slice-keyword-to-task` — so the `build/task/...` pool spelling is settled before any selection-order-adjacent test prose is touched (and to serialise the two test-touching tasks cleanly).

## Prompt

> Goal: tidy three small residual-`slice`/`spec` clusters, per brief `code-identifier-slice-prd-to-task-brief-rename`: (1) stale test LABELS/comments naming an already-renamed identifier, (2) clear current-concept test FIXTURES + stale `scan`/`close-job` describe-string prose, (3) make `skills/drive-tasks/SKILL.md` self-sufficient (drop the done-task anecdote/provenance; keep the rule). Clean break.
>
> FIRST verify reality: confirm the dependency `rename-selection-pool-slice-keyword-to-task` landed (the pool keyword is `task`). Confirm `review-protocol-doc.test.ts` labels still say `buildSlice*` while calling `buildTask*`; confirm `scan.test.ts` describe-strings still say `specs[]`.
>
> SCOPE FENCES (do NOT touch): `slug-namespace.test.ts` fixture FOLDER words (`'spec'`/`'spec-sliced'`) and any `helpers/gitRepo.ts` fixture-word usage (separate task); `LoneSlice`/`reviewSlice`/`LoneSliceReviewGate` (live src, separate); the `SelectionPool` keyword (the dependency owns it). Keep immutable historical slugs as slug tokens; only reframe PROSE that cites them as provenance.
>
> Where to look: `test/review-protocol-doc.test.ts`, `test/advance-release-crash-safe.test.ts`, `test/intake.test.ts`, `test/scan.test.ts`, `test/close-job.test.ts`, `test/workspace.test.ts`, `test/setup-prompt-guidance-question.test.ts`, `test/surface-blockers-gate.test.ts`, `test/task-acceptance-gate.test.ts`, and `skills/drive-tasks/SKILL.md`. Run `pnpm format`.
>
> Done = build/test/format:check green, stale labels/fixtures/prose renamed, drive-tasks skill self-sufficient, scope fences intact, no workflow touched.

---

### Claiming this task

```sh
dorfl claim rename-residual-slice-test-labels-and-skill-provenance --arbiter <remote>
git fetch <remote> && git switch -c work/rename-residual-slice-test-labels-and-skill-provenance <remote>/main
git mv work/tasks/todo/rename-residual-slice-test-labels-and-skill-provenance.md work/tasks/done/rename-residual-slice-test-labels-and-skill-provenance.md
```

## Gate-3 follow-up (2026-06-23, conductor) — finish the close-job.test.ts describe coherently

A first build correctly renamed only the FIRST `close-job.test.ts` it-block, leaving the rest of its describe on old vocabulary (an incoherent half-rename). Continuing from the kept branch, ALSO sweep the WHOLE describe so it reads coherently:
- Describe titles: `runCloseJob — the SPEC case (...)` -> `... the brief case (...)`; `runCloseJob — the lone-slice case (...)` -> `... the lone-task case (...)`.
- Sibling it-block test NAMES: `leaves the SPEC issue OPEN when a prd:<slug> slice is NOT yet ...` -> brief/task wording; `finds the SPEC issue from work/briefs/tasked/ too (a SPEC that has been sliced)` -> brief/tasked wording; `a fanned slice carries prd: (NOT issue:) and reaches the number via the SPEC only` -> `a fanned task carries brief: ...`; `closes a lone slice (issue:, no prd:) ...` / `leaves a lone slice OPEN ...` -> lone-task wording.
- Slug fixtures `my-spec` -> `my-brief` (and the matching `brief: 'my-spec'` refs + `toContain('my-spec')` assertions, together).
- **SCOPE FENCE:** leave the `write('spec', ...)` / `write('spec-sliced', ...)` FOLDER-WORD first args verbatim — the fixture-folder compat-seam task `clean-break-fixture-folder-vocab-compat-seam` owns those. Only the describe/it NAMES + the `my-spec` slug fixtures here.
- Keep all the already-correct work from the first build (labels, vars, scan prose, skill self-sufficiency, the other fixtures). Gate green.
