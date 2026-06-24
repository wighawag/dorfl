---
title: Rename slicing/PRD source modules + symbols (slicing.ts, slicer-review-loop, prd-complete, UncertainSlice, etc.) to tasking vocabulary
slug: rename-slicing-modules-and-symbols-to-tasking
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: [rename-cli-verb-and-flags-do-prd-to-do-brief]
covers: []
---

## What to build

Rename the source MODULE files and the in-code SYMBOLS that still carry slice/PRD/slicing, with their imports and tests, to the tasking vocabulary. This is the bulk module-level cutover.

Module/file renames (and their test files): `slicing.ts`, `slicing-lock.ts`, `slicing-eligibility.ts`, `slicer-review-loop.ts`, `prd-complete.ts` → tasking-named equivalents (e.g. `tasking.ts`, `tasking-lock.ts`, `tasking-eligibility.ts`, `tasker-review-loop.ts`, `brief-complete.ts`).

Symbol renames: `UncertainSlice` / `uncertainSlices`, `decompositionUnclear` (and the "PRD" in its doc comment), `buildSlicingBrief`, `markSliceNeedsAnswers`, `readCandidates`/`slices` fields. Keep the `SidecarDisposition` VALUE constants as already-correct (`promote-task` etc.).

> **SCOPE NARROWED 2026-06-23 (decided conductor + human, during the `drive-tasks` drive — task SPLIT).** This task is now the mergeable RENAME unit only: (a) the module-FILE renames, (b) the in-code SYMBOL/type renames + every reference, (c) fixing any dangling `{@link …}` whose TARGET this task renamed away (the build does not catch these), and (d) the standalone TEST-file renames. The BROAD slice/PRD/slicing → task/brief/tasking sweep of free-prose DOC COMMENTS and USER-FACING MESSAGE STRINGS across the large touched modules (`do.ts`, `ledger-read.ts`, `review-gate.ts`, `close-job.ts`, `scan.ts`, `prompt.ts`, `select-priority.ts`, `item-lock.ts`, `mirror-pool-scan.ts`, the `cli.ts` `--help` strings, etc. — ~480 lines, judgement-heavy) is **carved out** into the follow-up task `rename-src-comment-prose-slicing-to-tasking` (which the protocol-doc/protocol-prose tasks do NOT block on). Gate-2 blocked this task three times purely on that prose residue while the renames themselves were green; splitting lets the rename land and unblock the chain. So here you fix ONLY the symbol-driven dangling links + stale module-FILENAME references in comments (the small, literal, no-judgement set below), NOT the broad concept-prose sweep.

Standalone TEST-file renames (these carry slice/prd in the NAME but do not pair 1:1 with a renamed src module — rename them too, via `git mv`, updating their describe/it text): `slice-acceptance-gate.test.ts`, `intake-lone-slice-review.test.ts`, `pre-prd-staging-and-promote.test.ts`, `slicer-maxreview-config.test.ts`, plus the per-module test files paired with the renamed sources (`slicing*.test.ts`, `slicer-review-loop.test.ts`, `prd-complete.test.ts`). EXCLUDE `slicing-protocol-doc.test.ts` — it is renamed by the dependent protocol-doc task, not here.

NOTE: this task does NOT rename the protocol-doc FILE or its inlined path in the tasking-brief prompt builder — that is the separate `rename-protocol-doc-to-tasking` task, which is blockedBy this one. Leave the `work/protocol/SLICING-PROTOCOL.md` path string for that task to avoid a double-touch conflict.

## Acceptance criteria (NARROWED — the mergeable rename unit; broad comment-prose sweep deferred to `rename-src-comment-prose-slicing-to-tasking`)

- [ ] The listed module files are renamed (via `git mv`) with all imports updated; no live `*.ts` filename carries slice/slicer/prd.
- [ ] The listed symbols/types are renamed with all references updated.
- [ ] No DANGLING `{@link …}`: every `{@link X}` whose target symbol THIS task renamed away points at the new name (the build does not type-check `@link`, so verify by grep). Targets whose symbol still EXISTS (e.g. `dispatchSlice`, `LONE_SLICE_REVIEW_MAX_ROUNDS`, the intake `{slice,prd}` wire FIELDS `sliceSlug`/`sliceTitle`/`sliceBody`/`prdSlug`/`prdTitle` — governed by Decision 2, NOT renamed here) are KEPT verbatim.
- [ ] Stale module-FILENAME references in comments that name a file THIS task renamed/deleted are updated to the new filename (e.g. `slicing.ts`→`tasking.ts`, `slicer-review-loop.ts`→`tasker-review-loop.ts`, `slicing-lock.ts`→`tasking-lock.ts`, `prd-complete.ts`→`brief-complete.ts`).
- [ ] The coupled doc/symbol-consistency tests (e.g. the tasker-review-loop + tasking tests, `review-verdict` channel tests) are updated in this task; suite green.
- [ ] The protocol-doc FILE path string is intentionally left unchanged (handled by the dependent doc task).
- [ ] OUT OF SCOPE (deferred to `rename-src-comment-prose-slicing-to-tasking`): the broad sweep of free-prose slice/PRD/slicing comments + user-facing message strings across the large modules. Do NOT attempt it here; a reviewer must NOT block this task on it.

## Blocked by

- `rename-cli-verb-and-flags-do-prd-to-do-brief` — the CLI/config/token tasks import these modules; renaming the modules last avoids churn against their in-flight changes.

## Prompt

> Goal: rename the slice/PRD-named source modules and in-code symbols to tasking vocabulary, per brief `code-identifier-slice-prd-to-task-brief-rename`. Pure rename, no behaviour change.
>
> FIRST check reality (launch snapshot): confirm these modules/symbols still exist and that the earlier token/config/CLI rename tasks have LANDED (this task assumes their new names). If imports already moved, reconcile; if something contradicts, route to needs-attention.
>
> Where to look: search the `src/` tree for `slic`/`prd` in filenames, type names, function names, and doc comments. Use `git mv` for file renames so history follows. Update the doc-consistency tests that assert symbol/channel names in the same task.
>
> Explicitly OUT of scope here: the `work/protocol/SLICING-PROTOCOL.md` filename and the prompt builder's inlined doc path — the dependent `rename-protocol-doc-to-tasking` task owns those. Do not touch that path string.
>
> Done = build/test/format:check green, no slice/slicer/prd in live `*.ts` filenames or symbols (excepting the deliberately-deferred protocol-doc path + the out-of-scope intake `{slice,prd}` wire fields + the still-defined `dispatchSlice`/`LONE_SLICE_*`), every `{@link}` resolving, stale module-FILENAME comment refs updated, behaviour unchanged. The BROAD comment/string prose sweep is OUT of scope (the follow-up `rename-src-comment-prose-slicing-to-tasking` task).
>
> NARROWED-SCOPE HANDOFF (2026-06-23): the file + symbol renames are already done and green on the kept branch; the dangling `{@link}` are already fixed (the 5 remaining in `intake.ts` point at STILL-LIVE targets — the `{slice,prd}` wire fields `sliceTitle`/`prdTitle`, `dispatchSlice`, `LONE_SLICE_REVIEW_MAX_ROUNDS` — KEEP them). The ONLY remaining in-scope edit is updating 11 stale module-FILENAME references in comments to the renamed filenames (a pure, literal find/replace — no concept judgement):
>
> - `work-layout.ts:203` and `:213`: `prd-complete.ts` → `brief-complete.ts`
> - `verdict-json.ts:5`: `slicer-review-loop.ts` → `tasker-review-loop.ts`
> - `review-gate.ts:256` and `:315`: `slicer-review-loop.ts` → `tasker-review-loop.ts`
> - `ledger-write.ts:71`: `slicing-lock.ts` → `tasking-lock.ts`
> - `ledger-read.ts:513` and `:533`: `slicing.ts` → `tasking.ts` (the `.ts` FILENAME only; leave surrounding concept prose like `readSlicedSlugs` for the follow-up prose task)
> - `intake.ts:1720` and `:2279`: `slicing.ts` → `tasking.ts` (filename only)
> - `do.ts:666`: `slicing.ts` → `tasking.ts` (filename only)
>
> Do NOT do the broad slice/PRD concept-prose sweep (deferred). After these 11 edits, `grep -rnE '(slicing|slicing-lock|slicer-review-loop|prd-complete)\.ts' packages/dorfl/src` must return zero. Then re-run the gate.

---

### Claiming this task

```sh
dorfl claim rename-slicing-modules-and-symbols-to-tasking --arbiter <remote>
git fetch <remote> && git switch -c work/rename-slicing-modules-and-symbols-to-tasking <remote>/main
git mv work/tasks/todo/rename-slicing-modules-and-symbols-to-tasking.md work/tasks/done/rename-slicing-modules-and-symbols-to-tasking.md
```

## Requeue 2026-06-22

Gate-2 BLOCK fix (fixable; continue from kept branch — the file/symbol renames are done, finish the sweep). Three gaps to close:

(1) DOC COMMENTS + USER-FACING MESSAGE STRINGS in the renamed modules still use slice/PRD/slicing/slicer vocabulary — this is the task's CORE deliverable (criterion #2) and is largely undone. Sweep tasking.ts (~87 lines), tasker-review-loop.ts (~54), tasking-lock.ts (~12), tasking-eligibility.ts (~6). Concrete examples to fix: tasker-review-loop.ts log/note strings 'Slicer review loop did not converge...' / 'Slicer review loop converged...' / note('Slicer review loop — fresh context...') -> 'Tasker review loop...'; tasking-lock.ts USER-FACING messages "LOCKED '...' for slicing" / 'RELEASED the slicing lock' / "Routed the slicing of '...'" -> tasking wording; tasking-eligibility.ts comment '/** Slugs of briefs that are already SLICED */' -> 'already TASKED'. KEEP verbatim the immutable slug references to OTHER tasks/briefs (e.g. slice-acceptance-gate, slicer-review-edit-loop, auto-slice, runner-deterministic-slice-placement-policy-and-precedence) per Decision 5.

(2) RENAME the missed standalone test file: git mv test/intake-lone-slice-review.test.ts -> test/intake-lone-task-review.test.ts and update its describe/it text (criterion #1). The other three standalone renames were done; this one was omitted.

(3) FIX dangling JSDoc {@link}: tasking.ts has {@link STAGED_SLICES_DIR} at lines ~337/366/1337/1348 and {@link slicerLoopModel} at ~244, but those symbols were renamed to STAGED_TASKS_DIR and taskerLoopModel — update the links to the new names.

KEEP everything else from your branch; just finish these. Re-run the gate; ensure no slice/slicer/prd vocabulary remains in the touched modules' comments/messages (excepting immutable foreign slugs), no live *.ts filename carries slice/slicer/prd, and no dangling @link. Do NOT touch work/protocol/SLICING-PROTOCOL.md or the prompt builder's inlined doc path (the dependent protocol-doc task owns those).

## Requeue 2026-06-23

Gate-2 BLOCKED this TWICE for the SAME defect class under-swept. The file renames and symbol renames are DONE and green (keep them). The remaining work is a WIDE, MECHANICAL, GENERALISING sweep — do NOT fix only the lines named below; fix EVERY instance of each class across ALL of packages/dorfl/src, then SELF-VERIFY to zero. "Touched modules" = EVERY module whose symbols this task renamed (cli.ts, do.ts, intake.ts, ledger-read.ts, scan.ts, select-priority.ts, mirror-pool-scan.ts, close-job.ts, review-gate.ts, review-verdict.ts, prompt.ts, item-lock.ts, and the tasking-* modules), NOT just the 5 renamed files.

GAP 1 — ALL dangling JSDoc {@link} (tsc does NOT check these, so the green gate hides them). Every {@link X} whose target X was renamed away must point at the NEW name. Confirmed renamed targets (old -> new): buildSliceAcceptancePrompt->buildTaskAcceptancePrompt, harnessSliceReviewGate->harnessTaskReviewGate, heldSliceSlugs->heldTaskSlugs, isPrdComplete->isBriefComplete, LedgerPrdItem->LedgerBriefItem, LedgerPrdPool->LedgerBriefPool, performSlice->performTask, PrdExistence->BriefExistence, prdTitle->briefTitle, promoteFromPrePrd->promoteFromPreBrief, readLocalPrdPool->readLocalBriefPool, resolvePrdExistence->resolveBriefExistence, resolveSlice->resolveTask, sliceablePrds->taskableBriefs, SliceResult->TaskResult, sliceTitle->taskTitle, findPrdFileBySlug->findBriefFileBySlug, and the prds/slices ledger fields -> their renamed forms. For each {@link} target, grep for its DEFINITION; if no def exists, it was renamed — update the link. KEEP the still-defined LoneSlice* family verbatim (LONE_SLICE_REVIEW_MAX_ROUNDS, buildLoneSliceReviewPrompt, etc.) IF those symbols genuinely still carry that name in this task's scope.
  SELF-VERIFY: `grep -rnoE '\{@link [A-Za-z_]+\}' packages/dorfl/src | grep -iE 'Slice|Slicer|Prd'` must return ONLY links whose target symbol still EXISTS (grep its def). Zero dangling links.

GAP 2 — ALL stale slice/PRD/slicing/slicer vocabulary in COMMENTS and USER-FACING STRINGS across every touched module, swept to task/brief/tasking. This includes:
  - cli.ts USER-FACING --help strings: "auto-build undeclared ... slices" (x2 pairs ~L1021/1025/1102/1106), "run one agent on a slice prompt" (~L1119), "claim a slice" (~L1478) -> task vocabulary.
  - cli.ts guard docstrings/comments that now CONTRADICT the renamed code: the resolveTaskOnlySlug docstring (~L827-836) says "accept bare (= slice) + slice:, reject prd: ... operates on slices, not PRDs" but the code now accepts task: and rejects brief: with "operates on tasks, not briefs"; the repeated "Slice-only command (Section 3a): accept bare + slice:, reject prd:" comments (~L916/923/1339 and similar) -> rewrite to match the task:/brief: reality.
  - tasker-review-loop.ts log/note message strings: "Slicer review loop did not converge..." / "Slicer review loop converged..." / note('Slicer review loop - fresh context...') -> "Tasker review loop...".
  - tasking-lock.ts USER-FACING messages: "LOCKED '...' for slicing" / "RELEASED the slicing lock" / "Routed the slicing of '...'" -> tasking wording.
  - tasking-eligibility.ts: "/** Slugs of briefs that are already SLICED */" -> "already TASKED", and the ~6 other residual lines.
  - tasking.ts (~87 residual lines), and the same class anywhere else in the touched modules.
  This discharges the needsAnswers observation work/notes/observations/stale-prd-slice-tokens-in-cli-namespace-guard-comments.md (this task OWNS that comment prose) — delete or mark that observation resolved as part of this fix.

KEEP VERBATIM (Decision 5): immutable slug references to OTHER tasks/briefs and config keys not in this task's scope: e.g. slice-acceptance-gate, slicer-review-edit-loop, auto-slice, runner-deterministic-slice-placement-policy-and-precedence, the slicerLoop/slicerLoopMax/slicerLoopModel CONFIG KEYS (owned by a later task), and any historical slug. Do NOT touch work/protocol/SLICING-PROTOCOL.md or the prompt builder's inlined doc path (the dependent protocol-doc task owns those).

TERMINATION (self-verify ALL before finishing): (a) zero dangling {@link} per Gap 1's grep; (b) no live *.ts FILENAME carries slice/slicer/prd (you already renamed intake-lone-slice-review.test.ts? confirm it and the 3 others are renamed); (c) `grep -rniE 'slice|slicer|\bprd\b' packages/dorfl/src` returns ONLY immutable foreign slugs / out-of-scope config keys / the deliberately-kept LoneSlice family — every other hit is a miss to fix; (d) build/test/format:check green. Apply REVIEW-PROTOCOL lens 4: a second instance of any pattern means GENERALISE, never fix-one-and-stop.
