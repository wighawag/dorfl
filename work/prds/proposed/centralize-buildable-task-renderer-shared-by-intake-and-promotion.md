---
title: Centralize the buildable-task renderer shared by intake and triage/advance promotion
slug: centralize-buildable-task-renderer-shared-by-intake-and-promotion
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked — they move into tasks/ADRs and this prd settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

dorfl has TWO independent producers of a "buildable task" markdown file, and they
disagree on the schema — which silently births un-dispatchable tasks.

- **Intake** (`packages/dorfl/src/intake.ts`, `renderTask` ~L1617) turns an issue
  into a task and emits the FULL buildable-task shape:
  `## What to build` + `## Acceptance criteria` + `## Prompt` (with a thin default
  scaffold when the agent drafted no body).
- **Triage / advance promotion** (`packages/dorfl/src/triage-persist.ts`,
  `buildPromotedBody` ~L393) turns an answered observation into a task and emits
  ONLY `## What to build` + the observation's mechanism prose + (optional)
  `## Open questions`. It emits NO `## Prompt`.

The CONSUMER, `assembleWorkPrompt` (`packages/dorfl/src/prompt.ts:~623`), REQUIRES
a `## Prompt` heading and throws `task '<slug>' ... has no '## Prompt' section`
otherwise — and it only checks at DISPATCH time, after the claim lock is taken. So
every promotion mints a task that self-claims to a `state: stuck` lock on first
`advance`, wasting a dispatch and stranding a lock for a human to `requeue --reset`.
This is not rare: ~10 `advance: create .../tasks/ready/` promotions exist in history,
6 in the last few days (evidence + lock traces in
`work/notes/observations/advance-promotion-builds-promptless-task-that-self-claims-stuck-2026-06-25.md`).

The ROOT cause is that the buildable-task shape is not owned by one renderer. Each
producer hand-assembles frontmatter + headings, so they drift. Fixing the
`## Prompt` gap in `buildPromotedBody` alone (task
`promoted-task-emits-prompt-and-pre-claim-wellformedness-guard`, the interim guard)
removes today's symptom but leaves the underlying duplication that will drift again
the next time either producer changes.

This extraction was explicitly ANTICIPATED: PRD
`observation-discharge-by-deletion-self-contained-promotion-and-prd-route`
Resolved-decision 1 records "Sharing the prd-body RENDERING with intake may be
extracted later, but the WRITER is the CAS one." This PRD is that deferred
extraction, generalized to the TASK renderer (and, symmetrically, the PRD-body
renderer) — keeping each path's own WRITER (intake's branch+PR front door; the
triage-local `createItemThroughCas`) untouched.

## Solution

From a contributor's perspective: there is ONE function that renders a buildable
task's body (and one for a PRD body), and BOTH the intake front-door and the
triage/advance promotion path call it. A change to the buildable-task schema (e.g.
adding a section, changing a heading) is made in ONE place and both producers stay
in lockstep, so no producer can ever again mint a structurally-incomplete task. The
two callers keep their distinct WRITERS (how/where the file is committed); only the
BODY rendering is shared.

## User Stories

1. As a contributor, I want ONE renderer that produces a buildable task body
   (`## What to build` + `## Acceptance criteria` + `## Prompt`, plus an optional
   `## Open questions` block), so the schema lives in a single place.
2. As a contributor, I want `intake.renderTask` to call that shared renderer (its
   current full-shape behaviour preserved, including the thin default scaffold when
   no body was drafted), so intake's output is unchanged but no longer hand-rolled.
3. As a contributor, I want `triage-persist.buildPromotedBody` to call that shared
   renderer for the `task` artifact, so a promoted observation ALWAYS carries a
   `## Prompt` (seeded from its mechanism prose) and is dispatchable on its own —
   superseding the interim guard task's change 1 by relocating it into the shared
   renderer.
4. As a contributor, I want the symmetric PRD-body rendering shared too (or at
   least factored so the same drift cannot recur for PRDs), since both producers
   also emit PRD bodies and the same divergence risk applies.
5. As an operator, I want each producer to keep its OWN writer (intake's
   branch+integrate front door; promotion's triage-local `createItemThroughCas`),
   so this change touches RENDERING only and preserves every CAS / per-item-lock /
   loser-backs-off guarantee both paths rely on.
6. As an operator, I want the pre-claim well-formedness guard (from the interim
   task) RETAINED as defence in depth, so even a hand-authored or externally-edited
   malformed body is refused before a claim lock is taken — the shared renderer
   prevents the bug at the producer; the guard catches it at the consumer.
7. As a contributor, I want tests asserting BOTH producers emit the same required
   sections through the shared renderer (a single golden-shape test the two callers
   share), so a future schema change cannot silently apply to only one producer.

## Out of Scope

- Changing the WRITERS / integration modes of either producer (intake's branch+PR
  band vs. promotion's local CAS create) — this PRD shares the BODY renderer only.
- Changing how observations are captured, surfaced, or discharged — that is PRD
  `observation-discharge-by-deletion-self-contained-promotion-and-prd-route`.
- The interim fix itself: task
  `promoted-task-emits-prompt-and-pre-claim-wellformedness-guard` lands first and
  independently; this PRD supersedes its change 1 (the `## Prompt` synthesis moves
  into the shared renderer) while KEEPING its pre-claim guard (US #6).

## Further Notes

- Origin observation:
  `work/notes/observations/advance-promotion-builds-promptless-task-that-self-claims-stuck-2026-06-25.md`
  (the stuck-lock symptom, the producer/consumer schema mismatch, and the cause
  triage: autonomous task creation in advance, not a skill deficiency).
- Anticipated by PRD
  `observation-discharge-by-deletion-self-contained-promotion-and-prd-route`
  Resolved-decision 1 (the deferred "share the renderer with intake" note) and its
  done keystone `promotion-self-contained-body-and-delete-on-promote-task-route`
  (which delivered content self-containment but not the `## Prompt` schema).
- Interim guard task (lands first, superseded in part here):
  `work/tasks/backlog/promoted-task-emits-prompt-and-pre-claim-wellformedness-guard.md`.
- Key code seams: `intake.ts` `renderTask` (~L1617), `triage-persist.ts`
  `buildPromotedBody` (~L393), `prompt.ts` `assembleWorkPrompt` (~L623, the
  required-`## Prompt` consumer).
