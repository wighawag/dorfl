---
title: Rename slice/PRD code identifiers to task/brief (the deferred code-level cutover)
slug: code-identifier-slice-prd-to-task-brief-rename
needsAnswers: true
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/todo/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked — they move into tasks/ADRs and this brief settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Open questions

These MUST be resolved by a human before this brief is tasked (they decide scope and migration safety):

1. **Lock-ref identity migration.** Per-item locks are keyed by a namespaced identity (`prd:<slug>` / `slice:<slug>` on `refs/agent-runner/lock/<entry>`). If we rename the namespace tokens to `brief:`/`task:`, any lock ref already held in a live arbiter under the old token is orphaned (claim/release/status would no longer find it). Do we (a) accept a clean break (this repo has no external users; sweep/clear old locks manually), (b) read BOTH old and new tokens for a deprecation window, or (c) ship a one-shot ref-migration in `gc`? This is the single highest-risk decision.
2. **Config key compatibility.** `slicingIntegration`, `slicesLandIn` (value `pre-prd`/`prd`), `autoSlice`, and intake's per-emitted-type `{slice, prd}` are live `.agent-runner.json` keys. Hard cutover (no alias, matching the prior `allowAgents → autoBuild` and `promote-slice → promote-task` precedent) or a read-old-warn alias window?
3. **CLI verb compatibility.** `do prd:<slug>` and `--prds-land-in` are documented operator-facing surfaces. Hard cutover to `do brief:<slug>` / `--briefs-land-in`, or accept the old spelling with a deprecation warning?
4. **`=== SLICE-STOP ===` sentinel.** This exact string is matched by the runner in agent output (`STOP_SENTINEL_OPEN` in `agent-stop.ts`) and asserted by tests. Renaming it (e.g. `=== TASK-STOP ===`) is a clean break in the agent protocol; is that in scope, or do we keep the sentinel as a frozen wire token?
5. **Scope of the prose rewrite in `work/` history.** Hundreds of landed `work/tasks/done/`, `work/briefs/tasked/`, `work/notes/` files contain "slice"/"PRD". These are immutable launch snapshots / history. Confirm the rename touches ONLY live code + active docs (protocol source, skills, ADRs, CONTEXT.md — already done) and does NOT rewrite historical work items.
6. **Protocol filename + VERSION.** Renaming `skills/setup/protocol/SLICING-PROTOCOL.md` → `TASKING-PROTOCOL.md` requires updating the vendor script, `slicing.ts` `buildSlicingBrief` (which inlines the doc path into agent prompts), `to-task/SKILL.md`, the doc-consistency test, the mirror, and a VERSION bump. Confirm the file is renamed (vs. keeping the filename and only fixing prose).

## Problem

The user-facing vocabulary cut over to `task`/`brief` (folders, frontmatter, WORK-CONTRACT.md, CONTEXT.md, the protocol prose). But the CODE still pervasively uses the retired `slice`/`PRD`/`slicing` words as live identifiers, which is a coherence violation (CONTEXT.md "Coherence" section) and a transition hazard: a reader sees `task` in the docs and `slice`/`prd` in the code for the same concept. We also decided to retire the VERB "slicing" entirely in favour of **"tasking"** (a brief is *tasked* into tasks; the agent is the *tasker*), to remove the residual ambiguity during the transition.

A prior, prose-only pass already did the safe part: CONTEXT.md glossary cutover to task/brief/tasking, and the `promote-slice → promote-task` doc-vs-code fix in SURFACE-PROTOCOL.md. This brief covers the remaining CODE-LEVEL rename that was deliberately deferred because it is large (~96 src + ~140 test files) and entangled with live lock-ref identities, config keys, CLI verbs, and a wire sentinel.

## Solution (sketch — pending the open questions)

A staged, conflict-safe rename, sliced so each task is file-orthogonal and independently green:

- **Module/file renames:** `slicing.ts`, `slicer-review-loop.ts`, `slicing-lock.ts`, `slicing-eligibility.ts`, `prd-complete.ts`, and their tests → tasking-named equivalents.
- **Type/symbol renames:** `UncertainSlice`/`uncertainSlices`, `decompositionUnclear` ("PRD" in its doc comment), `SidecarDisposition` history comments, `buildSlicingBrief`, etc.
- **Namespace tokens:** `prd:`/`slice:` lock + CLI identities → `brief:`/`task:` (gated on Q1/Q3).
- **Config keys:** `slicingIntegration`, `slicesLandIn` (+ `pre-prd`/`prd` values), `autoSlice`, intake `{slice, prd}` (gated on Q2).
- **Wire sentinel:** `=== SLICE-STOP ===` (gated on Q4).
- **Protocol doc:** `SLICING-PROTOCOL.md` → `TASKING-PROTOCOL.md` + all referencing code/tests/vendor/VERSION (gated on Q6); rewrite "slicing"→"tasking", "the slicer"→"the tasker", "auto-slice"→"auto-task", "emitted slice shape"→"emitted task shape", "vertical slice"→"vertical task" in the protocol prose and the other protocol docs (REVIEW/CLAIM prose: "lone-slice review", `<prd>` placeholder, "the PRD's needs-attention reason").
- **Skills:** `drive-backlog`, `orchestrate`, `review`, `to-brief`, `to-task`, `work`, `promote`, `setup` SKILL.md prose still carrying slice/PRD.
- **ADRs in `docs/adr/`:** prose cutover (these are durable but editable for vocabulary coherence).

Each task keeps `pnpm -r build && pnpm -r test && pnpm format:check` green, updating the coupled doc-consistency tests in the SAME task as the rename they assert.

## Out of scope

- Rewriting historical `work/tasks/done/`, `work/briefs/tasked/`, `work/notes/`, and `work/questions/` files (immutable snapshots — Q5).
- Any behaviour change. This is a pure rename; the only semantic decisions are the migration/compat choices in the open questions.

## Notes

The prose-only predecessor work (CONTEXT.md + SURFACE-PROTOCOL.md `promote-task` fix + VERSION bump) landed green and is the baseline this brief builds on. See the CONTEXT.md vocabulary note (2026-06-22) which enumerates the exact code identifiers still to rename.
