---
title: The claimable task-pool folder is named `todo/` — `ready/` would be more precise
type: observation
status: spotted
spotted: 2026-06-20
needsAnswers: true
---

## What was seen

The task lifecycle folders are `tasks/backlog/` (STAGING, not yet admitted) →
`tasks/todo/` (the AGENT POOL, claimable) → `tasks/done/` / `tasks/cancelled/`
(WORK-CONTRACT.md "Layout" + conflict-safety rule 6: "the claimable predicate is
'in the pool `tasks/todo/` on `main` AND no lock held on its ref'").

This naming is actually CONSISTENT with mainstream Kanban (checked against six
sources: AgileSparks, Asana, ProofHub, Boards.cloud, Meister, Multiboard, web
search 2026-06-20). In the standard intake pattern, `Backlog` = the wider pool of
candidate work not yet committed, and the NEXT column (`To Do` / `Ready`) = work
committed and READY TO PULL. So dorfl's `backlog`=staging / `todo`=pool maps
onto the convention correctly. (Earlier in the originating conversation an agent
mis-claimed `backlog` was a "false friend" meaning the ready queue — that was wrong;
the sources confirm backlog is the not-yet-ready bucket in mainstream usage too.)

The residual, MINOR imprecision is the word `todo` specifically for the
COMMITTED/CLAIMABLE pool: several sources reserve the most cross-source-agreed term
**`Ready`** ("refined and ready to start", "committed, pull when you have capacity")
for that slot, while `To Do` is sometimes the fuzzier "stuff not done yet" bucket. A
reader carrying that fuzzier mental model can misread a `tasks/todo/` item as "a
loose to-do" rather than "a vetted item eligible for an agent to claim".

## Why it matters

`tasks/todo/` is a load-bearing protocol concept (the agent-claimable predicate
keys on it). A name whose everyday reading is loosest is the one most likely to be
misread by a fresh agent or human — and a misread here has real consequences
(thinking a `backlog/` item is claimable, or a `todo/` item is just a note). In the
originating conversation, an agent narrated a `backlog/` task as "runner-claimable",
the exact inversion this naming ambiguity invites.

## The question to decide (NOT decided here)

Should the claimable pool folder be glossed and/or RENAMED `tasks/ready/` for
precision? Two tiers:

- **Tier 1 (cheap, no behaviour change):** add a one-line gloss where `todo/` is
  defined — "the COMMITTED, claimable pool (the Kanban `Ready` sense), not a loose
  to-do list." (The contract already says "the AGENT POOL... eligible to claim"
  adjacent, so this is reinforcement, arguably optional.)
- **Tier 2 (ADR-worthy, real blast radius):** rename `tasks/todo/` → `tasks/ready/`.
  Touches WORK-CONTRACT.md (source + the `work/protocol/` copy — keep byte-identical
  per AGENTS.md), the `to-task`/`drive-backlog`/`orchestrate` skills, the placement
  resolver + `slicesLandIn` enum (currently uses `todo`/`backlog` as the
  pool/staging names — `src/config.ts`, `src/placement.ts`), tests, CONTEXT.md, and
  the website docs. NOT to be done casually; this observation only RAISES it.

## Provenance / refs

- WORK-CONTRACT.md "Layout" diagram + "Three honest integration modes" table
  (uses `todo`/`backlog` as pool/staging) + conflict-safety rule 6.
- `slicesLandIn` (`SlicesLandIn` type, `src/config.ts`; placement resolver
  `src/placement.ts`) — the enum values are the folder names, so a rename is not
  cosmetic.
- Kanban-convention check: web search 2026-06-20 (six sources listed above);
  strongest single statement of the Backlog→To Do commitment step: AgileSparks,
  "The Critical Difference Between Backlog and To Do".

## Note on scope

This is a NAMING/clarity signal, not a bug. Lowest-priority. Captured so the
naming question is not lost; a human decides whether Tier 1 / Tier 2 / drop.
