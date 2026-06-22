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

Symbol renames: `UncertainSlice` / `uncertainSlices`, `decompositionUnclear` (and the "PRD" in its doc comment), `buildSlicingBrief`, `markSliceNeedsAnswers`, `readCandidates`/`slices` fields, and the slice/PRD wording in doc comments across the touched modules (incl. `brand.ts`'s "PRDs, slices" mention). Keep the `SidecarDisposition` VALUE constants as already-correct (`promote-task` etc.); only fix stale slice/PRD wording in their comments.

Standalone TEST-file renames (these carry slice/prd in the NAME but do not pair 1:1 with a renamed src module — rename them too, via `git mv`, updating their describe/it text): `slice-acceptance-gate.test.ts`, `intake-lone-slice-review.test.ts`, `pre-prd-staging-and-promote.test.ts`, `slicer-maxreview-config.test.ts`, plus the per-module test files paired with the renamed sources (`slicing*.test.ts`, `slicer-review-loop.test.ts`, `prd-complete.test.ts`). EXCLUDE `slicing-protocol-doc.test.ts` — it is renamed by the dependent protocol-doc task, not here.

NOTE: this task does NOT rename the protocol-doc FILE or its inlined path in the tasking-brief prompt builder — that is the separate `rename-protocol-doc-to-tasking` task, which is blockedBy this one. Leave the `work/protocol/SLICING-PROTOCOL.md` path string for that task to avoid a double-touch conflict.

## Acceptance criteria

- [ ] The listed module files are renamed (via `git mv`) with all imports updated; no live `*.ts` filename carries slice/slicer/prd.
- [ ] The listed symbols/types are renamed with all references updated; doc comments in the touched modules use task/brief/tasking wording.
- [ ] The coupled doc/symbol-consistency tests (e.g. the slicer-review-loop + slicing tests, `review-verdict` channel tests) are updated in this task; suite green.
- [ ] The protocol-doc FILE path string is intentionally left unchanged (handled by the dependent doc task).

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
> Done = build/test/format:check green, no slice/slicer/prd in live `*.ts` filenames or symbols (excepting the deliberately-deferred protocol-doc path), behaviour unchanged.

---

### Claiming this task

```sh
agent-runner claim rename-slicing-modules-and-symbols-to-tasking --arbiter <remote>
git fetch <remote> && git switch -c work/rename-slicing-modules-and-symbols-to-tasking <remote>/main
git mv work/tasks/todo/rename-slicing-modules-and-symbols-to-tasking.md work/tasks/done/rename-slicing-modules-and-symbols-to-tasking.md
```
