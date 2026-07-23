---
title: 'Sweep WORK-CONTRACT.md + SURFACE-PROTOCOL.md prose slice/SPEC/slicing to task/brief/tasking (after the lock-action/flag code rename)'
slug: rename-protocol-prose-workcontract-and-surface-slicing-to-tasking
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: [rename-lock-action-token-slice-to-task]
covers: []
---

> **CARVED OUT 2026-06-23 (decided conductor + human, during the `drive-tasks` drive).** The sibling `rename-protocol-prose-and-skills-slicing-to-tasking` had a GLOBAL acceptance criterion ("no active protocol doc carries the retired vocabulary") that was unsatisfiable within its file list, because `WORK-CONTRACT.md` (~38 occurrences) and `SURFACE-PROTOCOL.md` (line 115) were never in any task's scope. Those two files are split out here. CRUCIALLY their `slic*` prose is ENTANGLED with still-live CODE identifiers (the lock action token `'slice'`, the residual `--slices-land-in` flag — see the observation `residual-slice-code-identifiers-lock-action-and-slices-land-in-flag`), so this prose sweep must run AFTER those code identifiers are renamed, or the rewritten prose would get ahead of the code and lie.

## What to build

Sweep the retired slice/SPEC/slicing/slicer vocabulary out of `skills/setup/protocol/WORK-CONTRACT.md` and `skills/setup/protocol/SURFACE-PROTOCOL.md` (and their byte-identical `work/protocol/` mirrors) to task/brief/tasking, where the word denotes the CURRENT concept. Bump `work/protocol/VERSION`; keep source vs mirror byte-identical apart from VERSION (per AGENTS.md: edit the SOURCE, mirror the change).

- `WORK-CONTRACT.md`: ~38 occurrences (slicing/sliced/slicer/auto-slice/re-slice/sliceable/double-sliced and any `slice`/`SPEC` noun for the current concept).
- `SURFACE-PROTOCOL.md`: line 115 "the single sources for slicing/reviewing judgement" → "tasking/reviewing judgement", plus any other residue.

When you write a CODE-IDENTIFIER reference in the prose (e.g. the lock action, the placement flag), use the SETTLED post-rename name (this task is sequenced after that code rename) — do NOT reintroduce `action: slice` / `--slices-land-in`.

## KEEP verbatim

Real historical slugs, the intake `{slice,spec}` wire vocabulary (Decision 2 lineage), and any genuinely-frozen token — called out where kept. Do not falsify a recorded historical state; note the current name in parentheses where helpful.

## Acceptance criteria

- [ ] `WORK-CONTRACT.md` and `SURFACE-PROTOCOL.md` carry no retired slice/SPEC/slicing/slicer vocabulary for a CURRENT concept (keep-verbatim categories preserved + called out).
- [ ] Any code-identifier reference in the swept prose matches the SETTLED post-rename code name (no `action: slice` / `--slices-land-in` reintroduced).
- [ ] Source `skills/setup/protocol/` and mirror `work/protocol/` byte-identical apart from VERSION; VERSION bumped.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green; any doc-consistency test updated in this task.

## Blocked by

- `rename-lock-action-token-slice-to-task` — that task renames the live `LockAction` token `'slice'` → `'task'`; this prose sweep writes the SETTLED `action: task` spelling into WORK-CONTRACT.md, so it must follow (otherwise the prose would get ahead of the code). (Authored 2026-06-23; the earlier empty `blockedBy: []` was a prose-only gate — now made machine-readable per the review finding. The `--slices-land-in` part of the original observation was corrected: that flag is already renamed, only comment refs remain, owned by `rename-src-comment-prose-slicing-to-tasking`.)

## Prompt

> Goal: sweep `WORK-CONTRACT.md` + `SURFACE-PROTOCOL.md` (source + mirror) prose slice/SPEC/slicing → task/brief/tasking, per brief `code-identifier-slice-prd-to-task-brief-rename`. PROSE only.
>
> FIRST check reality: confirm the lock-action token + `--slices-land-in` flag have been RENAMED in code (this task is sequenced after that); if they are still `slice`/`--slices-land-in`, STOP — the prose would get ahead of the code. For each `slic`/`spec` hit decide current-concept (rename) vs allowed-keep (historical slug / intake `{slice,spec}` wire / frozen token). Per AGENTS.md edit the SOURCE under `skills/setup/protocol/` and mirror into `work/protocol/`; bump VERSION; `diff -r` clean apart from VERSION. Run `pnpm format`.
>
> Done = build/test/format:check green, both files coherent with task/brief/tasking, code-identifier references matching settled code, source/mirror in sync.

---

### Claiming this task

```sh
dorfl claim rename-protocol-prose-workcontract-and-surface-slicing-to-tasking --arbiter <remote>
git fetch <remote> && git switch -c work/rename-protocol-prose-workcontract-and-surface-slicing-to-tasking <remote>/main
git mv work/tasks/todo/rename-protocol-prose-workcontract-and-surface-slicing-to-tasking.md work/tasks/done/rename-protocol-prose-workcontract-and-surface-slicing-to-tasking.md
```

## Requeue 2026-06-23

Gate-2 verdict JSON-parse crash (position 6114) AFTER green Gate-1 (2585 tests) and AFTER the WORK-CONTRACT/SURFACE prose sweep was applied. Recurring infra/gate fault, not the work. Continue from the kept branch; re-run gate + Gate-2.
