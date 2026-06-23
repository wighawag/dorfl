---
title: Clean-break prose sweep — CONTEXT.md + ADRs + residual skills (no transition scaffolding, no old naming)
slug: clean-break-context-adr-and-skills-prose
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: [fix-scan-json-brief-pool-jq-and-close-job-via, rename-advance-rung-and-sliced-outcome-tokens, complete-intake-slice-prd-to-task-brief-cutover]
covers: []
---

> **AUTHORED 2026-06-23 (conductor + human, post-rename cleanup).** The code-identifier renames are done; this is the final PROSE clean break. The maintainer's rule, verbatim: **"ADRs are about the WHY, so the only place for `slice` is where we explain why we moved from slice to task; if we do not have such an ADR, no need to add it; everywhere else, rename all."** There is NO such why-slice->task ADR today (verified), so there is NO exception — rename `slice`/`prd`/`slicing` everywhere in the ADRs. And remove ALL transition/migration scaffolding (no "renamed from X", "as-yet-unrenamed", "NOT yet reflected", "tracked as a separate brief", "the old name", transitional "Forward note" blocks): the docs must read as if the system was ALWAYS task/brief/tasking. Blocked on the three code-fix tasks so the prose references the SETTLED identifiers.

## What to build

A clean-break vocabulary + scaffolding sweep across the live current-state prose. THREE surfaces:

### 1. CONTEXT.md (the glossary — current-state source of truth)
- DELETE the stale "Vocabulary note (2026-06-22)" block (line ~5) entirely — it says the code rename is "intentionally NOT yet reflected here", which is now FALSE.
- Strip every now-false / transitional parenthetical: "(The `autoSlice` config key is the as-yet-unrenamed code name ...)", "(the key name is the as-yet-unrenamed code identifier)", "the CLI verb token `do prd:` is the as-yet-unrenamed code spelling", "renamed from the old name `allowAgents` ...", "DISTINCT from intake's per-EMITTED-TYPE `{slice, prd}` ... also unrenamed code names", etc. The glossary should describe the CURRENT system in task/brief/tasking with NO archaeology. (A bare factual "X is resolved like Y" stays; the "it used to be Z / Z is the unrenamed name" clauses go.)
- Net: zero `slice`/`prd`/`slicing` in CONTEXT.md except a genuinely immutable historical slug if one is referenced as provenance (call it out).

### 2. docs/adr/*.md (13 files — rename all; NO why-ADR exception exists)
- Rename every `slice`/`PRD`/`slicing`/`slicer` denoting a current concept -> task/brief/tasking/tasker.
- REMOVE the transitional "Forward note (2026-06-2x — `code-identifier-...`)" blocks added during the rename (12 files have them) — the bodies now just say task/brief directly, so the "read every `slice` below as `task`" scaffolding is dead weight.
- Update stale code-identifier mentions to the SETTLED names (`autoTask`, `taskingIntegration`, `tasksLandIn`/`briefsLandIn`, `action: task`, `do brief:`, the `{task,brief}` intake outcomes, `'tasked'`, `build-task`/`task-brief` rungs).
- **`git mv docs/adr/slices-land-in-runner-deterministic-precedence.md -> docs/adr/tasks-land-in-runner-deterministic-precedence.md`** (the filename carries `slices`; the body title `slicesLandIn precedence ...` -> `tasksLandIn precedence ...`). The only referencer of the old filename is a landed `work/tasks/done/` history file (leave that verbatim — immutable history).
- A decision's recorded SUBSTANCE must stay true (don't falsify what was decided); only the NAMES move. Keep genuinely-immutable historical slugs verbatim (e.g. `remove-sliced-marker-step-b`, `slice-acceptance-gate`, any `*-slicing-*` task/brief slug referenced as provenance) — call them out.
- If, while sweeping, you find a place that genuinely needs to explain WHY slice->task (a real decision rationale), the rule says do NOT invent a why-ADR; just rename. (There is no such ADR; do not add one.)

### 3. Residual skills (a few SKILL.md hits left after the earlier sweep)
- `skills/drive-tasks/SKILL.md`, `skills/setup/SKILL.md`, `skills/to-brief/SKILL.md`, `skills/work/SKILL.md` — sweep the remaining current-concept `slice`/`prd`/`slicing` prose to task/brief/tasking; keep immutable slugs.

## KEEP verbatim (called out where kept)
Immutable historical slugs of landed tasks/briefs; the brief slug `code-identifier-slice-prd-to-task-brief-rename` itself; any reference inside a quoted past decision where renaming would falsify the record (rare — prefer renaming the concept and leaving only a true historical-slug token).

## Acceptance criteria

- [ ] CONTEXT.md carries NO `slice`/`prd`/`slicing` current-concept vocabulary and NO transition scaffolding (no "as-yet-unrenamed"/"NOT yet"/"renamed from"/"the old name"); the 2026-06-22 vocabulary note is gone; it reads as a clean current-state glossary.
- [ ] No `docs/adr/*.md` carries `slice`/`PRD`/`slicing`/`slicer` for a current concept; the transitional "Forward note" blocks are removed; stale code-identifier mentions match the settled names; recorded decision SUBSTANCE is intact; immutable historical slugs kept + called out.
- [ ] `docs/adr/slices-land-in-...md` is `git mv`d to `tasks-land-in-...md` with its title updated; no live referencer breaks (the only ref is landed `work/` history, left verbatim).
- [ ] The residual `skills/*/SKILL.md` hits are swept.
- [ ] No transition/migration scaffolding phrasing remains in the swept surfaces ("renamed from", "formerly", "as-yet-unrenamed", "NOT yet reflected", "tracked as a separate brief", "used to be", a transitional Forward-note block).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green (format covers the markdown; a doc-consistency test, if any asserts touched ADR/CONTEXT prose, updated in this task).

## Blocked by

- `fix-scan-json-brief-pool-jq-and-close-job-via`, `rename-advance-rung-and-sliced-outcome-tokens`, `complete-intake-slice-prd-to-task-brief-cutover` — so this prose references the SETTLED code identifiers (the intake `{task,brief}` outcomes, `'tasked'`, the `build-task`/`task-brief` rungs, etc.) rather than getting ahead of the code.

## Prompt

> Goal: the final CLEAN-BREAK prose sweep, per brief `code-identifier-slice-prd-to-task-brief-rename`. Rule (maintainer, verbatim): ADRs are about the WHY — the ONLY place `slice` may stay is an ADR explaining why we moved slice->task; there is NO such ADR, so rename `slice`/`prd`/`slicing` EVERYWHERE in the ADRs, do NOT add a why-ADR. Strip ALL transition/migration scaffolding everywhere (CONTEXT.md, ADRs, skills): no "renamed from", "as-yet-unrenamed", "NOT yet reflected", "tracked as a separate brief", no transitional Forward-note blocks. The prose must read as if the system was ALWAYS task/brief/tasking.
>
> FIRST verify reality: confirm the three code-fix tasks landed (intake `{task,brief}` outcomes, `'tasked'` outcome, `build-task`/`task-brief` rungs are SETTLED) so your prose uses the real current names. If not, route to needs-attention (do not get ahead of the code).
>
> Where to look: CONTEXT.md (delete the 2026-06-22 vocabulary note + every "as-yet-unrenamed"/"renamed from" parenthetical), `docs/adr/*.md` (rename all current-concept slice/prd/slicing; remove the `Forward note` blocks; `git mv slices-land-in-...md -> tasks-land-in-...md` + its title), and the residual `skills/{drive-tasks,setup,to-brief,work}/SKILL.md`. Keep immutable historical slugs verbatim and call them out. Do NOT falsify any recorded decision's substance. Run `pnpm format`.
>
> Done = format:check green, zero current-concept slice/prd/slicing + zero transition scaffolding in CONTEXT.md/ADRs/skills, the ADR file renamed, decision history intact.

---

### Claiming this task

```sh
agent-runner claim clean-break-context-adr-and-skills-prose --arbiter <remote>
git fetch <remote> && git switch -c work/clean-break-context-adr-and-skills-prose <remote>/main
git mv work/tasks/todo/clean-break-context-adr-and-skills-prose.md work/tasks/done/clean-break-context-adr-and-skills-prose.md
```
