---
title: Rename slice/PRD code identifiers to task/brief (the deferred code-level cutover)
slug: code-identifier-slice-prd-to-task-brief-rename
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/todo/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked — they move into tasks/ADRs and this brief settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Decisions (resolved by the maintainer before tasking)

All six migration/scope questions are RESOLVED; the rename is a CLEAN BREAK throughout (this repo has no external users owed a migration window, matching the `allowAgents → autoBuild` and `promote-slice → promote-task` precedents). The resolutions are load-bearing on the task boundaries below.

1. **Lock-ref identity migration — CLEAN BREAK + one-shot sweep.** Rename the namespace tokens `prd:`/`slice:` → `brief:`/`task:` on `refs/agent-runner/lock/<entry>`. No dual-read window. Old-token locks held in a live arbiter at cutover are orphaned; clear them with a one-shot `gc --ledger` sweep (the existing stuck/orphan-lock reaper path) and document the manual step in the cutover task. No long-lived back-compat reader.
2. **Config keys — HARD CUTOVER, no alias.** `slicingIntegration` → `taskingIntegration`; `slicesLandIn` → `tasksLandIn` with values `pre-prd`/`prd` → `staging`/`pool` (or `backlog`/`todo` to match the folder vocabulary — pick the spelling that matches the live folder names at task time); `autoSlice` → `autoTask`; intake per-emitted-type `{slice, prd}` → `{task, brief}`. No read-old-warn alias.
3. **CLI verbs — HARD CUTOVER.** `do prd:<slug>` → `do brief:<slug>`; `--prds-land-in` → `--briefs-land-in`; `--slicer-loop*` → `--tasker-loop*`. No deprecated-spelling acceptance.
4. **Wire sentinel — RENAME.** `=== SLICE-STOP ===` → `=== TASK-STOP ===` (and `END SLICE-STOP` → `END TASK-STOP`). It is an internal agent-output wire token; clean break is fine. Update `STOP_SENTINEL_OPEN`/`STOP_SENTINEL_CLOSE` in `agent-stop.ts`, the prompt that emits it, and every asserting test in the SAME task.
5. **History — OUT OF SCOPE.** The rename touches ONLY live code + active docs (protocol source + mirror, skills, ADRs; CONTEXT.md + SURFACE-PROTOCOL.md already done). It does NOT rewrite landed `work/tasks/done/`, `work/briefs/tasked/`, `work/notes/`, or `work/questions/` files — they are immutable launch snapshots/history.
6. **Protocol filename — RENAME.** `skills/setup/protocol/SLICING-PROTOCOL.md` → `TASKING-PROTOCOL.md`, updating the vendor script, `slicing.ts` `buildSlicingBrief` (the inlined doc path in agent prompts), `to-task/SKILL.md`, the doc-consistency test, the mirror, and a VERSION bump — all in one task.

## Problem

The user-facing vocabulary cut over to `task`/`brief` (folders, frontmatter, WORK-CONTRACT.md, CONTEXT.md, the protocol prose). But the CODE still pervasively uses the retired `slice`/`PRD`/`slicing` words as live identifiers, which is a coherence violation (CONTEXT.md "Coherence" section) and a transition hazard: a reader sees `task` in the docs and `slice`/`prd` in the code for the same concept. We also decided to retire the VERB "slicing" entirely in favour of **"tasking"** (a brief is *tasked* into tasks; the agent is the *tasker*), to remove the residual ambiguity during the transition.

A prior, prose-only pass already did the safe part: CONTEXT.md glossary cutover to task/brief/tasking, and the `promote-slice → promote-task` doc-vs-code fix in SURFACE-PROTOCOL.md. This brief covers the remaining CODE-LEVEL rename that was deliberately deferred because it is large (~96 src + ~140 test files) and entangled with live lock-ref identities, config keys, CLI verbs, and a wire sentinel.

## Solution

A staged, conflict-safe CLEAN-BREAK rename across the surfaces that still carry slice/PRD/slicing as live code identifiers: lock/CLI namespace tokens, config keys, CLI verbs/flags, the agent-output wire sentinel, the source modules + symbols, the protocol doc filename, and the remaining doc/skill/ADR prose. Each unit keeps `pnpm -r build && pnpm -r test && pnpm format:check` green and updates the coupled doc-consistency tests in the SAME unit as the rename they assert.

> Tasked-out: the per-surface implementation detail now lives in the emitted tasks (`work/tasks/*`), ordered by `blockedBy` to serialize shared-file touches (tokens → config → CLI → modules → protocol-doc → protocol/skills prose; the sentinel and the ADR-prose sweep are file-orthogonal and startable immediately). The CLEAN-BREAK rationale is in the Decisions section above.

## Out of scope

- Rewriting historical `work/tasks/done/`, `work/briefs/tasked/`, `work/notes/`, and `work/questions/` files (immutable snapshots — Decision 5).
- Any behaviour change. This is a pure rename; the only semantic choices are the CLEAN-BREAK migration/compat decisions recorded above.

## Notes

The prose-only predecessor work (CONTEXT.md + SURFACE-PROTOCOL.md `promote-task` fix + VERSION bump) landed green and is the baseline this brief builds on. See the CONTEXT.md vocabulary note (2026-06-22) which enumerates the exact code identifiers still to rename.
