---
title: Centralize the buildable-task renderer shared by intake and triage/advance promotion
slug: centralize-buildable-task-renderer-shared-by-intake-and-promotion
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked — they move into tasks/ADRs and this prd settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

dorfl has TWO independent producers of a "buildable task" markdown file, and the
buildable-task section schema (`## What to build` + `## Acceptance criteria` +
`## Prompt`) is not owned by one renderer — so the two producers can (and did)
DRIFT apart silently. The two producers are NOT symmetric, which sharpens what is
actually shareable:

- **Intake** (`packages/dorfl/src/intake.ts`, `renderBacklogTask` ~L1580) turns an
  issue into a task. It does NOT structurally assemble the body: it frontmatter-
  wraps a `body` the intake decision-agent already DRAFTED (headings and all), and
  supplies a thin DEFAULT SCAFFOLD (`## What to build` + `## Acceptance criteria` +
  `## Prompt`) ONLY when the agent drafted no body. So the only schema intake
  OWNS — and the only part a shared renderer can take from it — is that
  empty-body fallback skeleton. (Its PRD sibling `renderPrd` ~L1636 is the same
  wrapper+scaffold shape for the PRD body.)
- **Triage / advance promotion** (`packages/dorfl/src/triage-persist.ts`,
  `buildPromotedBody` ~L393) turns an answered observation into a task by FULLY
  CONSTRUCTING the body from structured pieces: `## What to build` (the mechanism
  prose) + optional `## Open questions` + a `## Prompt` seeded from that prose.
  This is a true structured renderer — the producer a shared renderer fits best.

That the two AGREE today is RECENT and FRAGILE. Until the interim guard task
`promoted-task-emits-prompt-and-pre-claim-wellformedness-guard` landed
(`9b916d2`, 2026-06-25), `buildPromotedBody` emitted NO `## Prompt` at all, while
the consumer `resolveTask`/`extractPromptSection` (`packages/dorfl/src/prompt.ts`)
REQUIRES one and threw `task '<slug>' ... has no '## Prompt' section` only at
DISPATCH time, after the claim lock was taken — so every promotion minted a task
that self-claimed to a `state: stuck` lock (~10 such promotions in history; full
evidence + lock traces in
`work/notes/observations/advance-promotion-builds-promptless-task-that-self-claims-stuck-2026-06-25.md`).
The interim guard fixed the SYMPTOM (it added a `## Prompt` to `buildPromotedBody`
and a pre-claim well-formedness check), but it did so by hand-rolling a SECOND
copy of the `## Prompt` logic next to intake's — so the underlying DUPLICATION
remains, and the same drift will recur the next time either producer's schema
changes. The root cause (no single owner of the buildable-task shape) is still
open; this PRD closes it before the two hand-rolled copies diverge again.

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
2. As a contributor, I want intake's DEFAULT-SCAFFOLD (the empty-body fallback in
   `renderBacklogTask`, and the PRD scaffold in `renderPrd`) to use the shared
   renderer's canonical section skeleton, so intake's fallback and promotion's body
   AGREE on section names/order and cannot drift — with intake's output otherwise
   byte-for-byte unchanged (the drafted-body path is untouched; only the
   no-body-drafted scaffold is sourced from the shared skeleton). (This is the
   honest, narrow win: intake hand-rolls only the fallback, not the whole body.)
3. As a contributor, I want `triage-persist.buildPromotedBody` to call that shared
   renderer for the `task` artifact, so a promoted observation ALWAYS carries a
   `## Prompt` (seeded from its mechanism prose) and is dispatchable on its own —
   REPLACING the interim guard task's hand-rolled `## Prompt` block (now in
   `buildPromotedBody`) with the shared renderer, so there is one copy, not two.
4. As a contributor, I want the PRD section skeleton shared too (intake's
   `renderPrd` scaffold and promotion's `buildPromotedBody(artifact:'prd')` body),
   so the same divergence cannot recur for PRDs. As with tasks the shareable part
   is the SCAFFOLD/section skeleton, since intake's `renderPrd` is a wrapper+
   fallback while promotion's PRD path is a structured renderer.
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
  `promoted-task-emits-prompt-and-pre-claim-wellformedness-guard` HAS LANDED
  (`9b916d2`, now in `work/tasks/done/`); this PRD supersedes its change 1 (the
  hand-rolled `## Prompt` synthesis is replaced by the shared renderer) while
  KEEPING its pre-claim guard (US #6).

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
- Interim guard task (landed, superseded in part here):
  `work/tasks/done/promoted-task-emits-prompt-and-pre-claim-wellformedness-guard.md`.
- Key code seams: `intake.ts` `renderBacklogTask` (~L1580, a wrapper+fallback) and
  its PRD sibling `renderPrd` (~L1636); `triage-persist.ts` `buildPromotedBody`
  (~L393, a structured renderer that now emits its own hand-rolled `## Prompt`);
  `prompt.ts` `extractPromptSection` / `resolveTask` (the required-`## Prompt`
  consumer + the pre-claim guard added by the interim task in `claim-cas.ts`).
- Producer asymmetry (the load-bearing scoping fact): intake's renderers are
  wrapper+fallback (the drafted body comes from an LLM, not a renderer), so the
  only thing intake can SHARE is the default-scaffold section skeleton; promotion
  fully constructs its body, so it adopts the shared renderer wholesale. The
  centralization unifies the SECTION SCHEMA both rely on, not every line of body.
