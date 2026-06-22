---
title: Rename SLICING-PROTOCOL.md to TASKING-PROTOCOL.md (+ vendor, prompt path, doc test, mirror, VERSION)
slug: rename-protocol-doc-slicing-to-tasking
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: [rename-slicing-modules-and-symbols-to-tasking]
covers: []
---

## What to build

Rename the tasking-discipline protocol doc and everything that references its filename/path (Decision 6):

- `skills/setup/protocol/SLICING-PROTOCOL.md` → `TASKING-PROTOCOL.md` (the SOURCE of truth) and its byte-identical mirror `work/protocol/SLICING-PROTOCOL.md` → `work/protocol/TASKING-PROTOCOL.md`.
- Rewrite the doc's prose to the tasking verb: title `# TASKING-PROTOCOL`, "the slicing discipline"→"the tasking discipline", "the slicer"→"the tasker", "auto-slice"→"auto-task", "emitted slice shape"→"emitted task shape", "vertical slice"→"vertical task", and the SLICED→TASKED wording (keeping real historical slugs verbatim).
- The vendor script (ships `dist/protocol/*`) → vendor the new filename.
- The tasking-brief prompt builder in the renamed tasking module (was `buildSlicingBrief`) → emit the new `work/protocol/TASKING-PROTOCOL.md` path.
- `skills/to-task/SKILL.md` → point at the new source + mirror paths.
- The doc-consistency test (was `slicing-protocol-doc.test.ts`) → assert the new filename + headings; rename the test file too.
- Bump `work/protocol/VERSION` past its current value.

## Acceptance criteria

- [ ] `TASKING-PROTOCOL.md` exists at the source-of-truth location and is byte-identical in `work/protocol/` and the vendored `dist/protocol/`; the old `SLICING-PROTOCOL.md` is gone from all three.
- [ ] The tasking-brief prompt builder references `work/protocol/TASKING-PROTOCOL.md`; `to-task/SKILL.md` points at the new paths.
- [ ] The doc-consistency test references the new filename + "emitted task shape" + the new vocabulary, renamed in this task; suite green.
- [ ] `work/protocol/VERSION` is bumped; source vs mirror diff is clean apart from VERSION.

## Blocked by

- `rename-slicing-modules-and-symbols-to-tasking` — the prompt builder lives in the renamed tasking module; this task edits the inlined doc path it deliberately left, so it must follow.

## Prompt

> Goal: rename the tasking-discipline protocol doc `SLICING-PROTOCOL.md` → `TASKING-PROTOCOL.md` and update every referencer (vendor script, the tasking-brief prompt builder's inlined path, `to-task/SKILL.md`, the doc-consistency test, the `work/protocol/` mirror, VERSION), per brief `code-identifier-slice-prd-to-task-brief-rename` Decision 6.
>
> FIRST check reality (launch snapshot): confirm the module rename task landed (the prompt builder now lives under its tasking name) and that `SLICING-PROTOCOL.md` is still the doc filename. If already partly renamed, reconcile; else route to needs-attention.
>
> Where to look: `skills/setup/protocol/` (source) + `work/protocol/` (mirror), the vendor-protocol script, the tasking module's prompt builder, `skills/to-task/SKILL.md`, and the protocol-doc test. Use `git mv` for the doc + test file renames. Keep source and mirror byte-identical (only VERSION differs).
>
> Per this repo's AGENTS.md: the protocol SOURCE is `skills/setup/protocol/`; mirror every change into `work/protocol/` so `diff -r` is clean apart from VERSION.
>
> Done = build/test/format:check green, the doc renamed end-to-end, source/mirror/vendor consistent, VERSION bumped.

---

### Claiming this task

```sh
agent-runner claim rename-protocol-doc-slicing-to-tasking --arbiter <remote>
git fetch <remote> && git switch -c work/rename-protocol-doc-slicing-to-tasking <remote>/main
git mv work/tasks/todo/rename-protocol-doc-slicing-to-tasking.md work/tasks/done/rename-protocol-doc-slicing-to-tasking.md
```
