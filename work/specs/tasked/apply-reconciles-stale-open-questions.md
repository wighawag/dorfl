---
title: "The apply rung must RECONCILE the resolved brief body (remove the now-stale open-questions block), not just append '## Applied answers'"
slug: apply-reconciles-stale-open-questions
---

> Launch snapshot, records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) plus the code; remaining work: `work/tasks/todo/` tasks. Originating signal: `work/notes/observations/apply-leaves-stale-open-questions-section-and-autonomy-note.md`. Found 2026-06-21 testing the advance apply step on brief `staging-surface-and-apply-promote-safety`.

## Problem Statement

When the advance APPLY rung consumes a fully-answered sidecar, it does its load-bearing job correctly: flips `needsAnswers:false`, deletes the sidecar in the same commit (the `needsAnswers:false <=> no active sidecar` invariant), and folds the human's answers into a new `## Applied answers <date>` body section. VERIFIED working on `staging-surface-and-apply-promote-safety` (commit `2eeb56a`).

But it leaves the body INTERNALLY CONTRADICTORY. `withAppliedAnswers` (`packages/dorfl/src/apply-persist.ts`) is a pure APPEND (`${base}\n${appliedAnswersBlock}`, comment: "Append-only (a prior record stays)"). It never touches the pre-existing content the answers supersede:

1. The original **`## Open questions`** section stays, listing every question as if still open, directly above the `## Applied answers` section that answers them.
2. The brief's **Autonomy-notes** prose still says "Set `needsAnswers: true` ... Clear once answered" even though it is now `false`.

So a `needsAnswers:false` brief STILL READS, in its own body, as awaiting answers. Only the frontmatter flag tells the truth.

This is claim-vs-reality drift the apply rung introduces in ITSELF, and it is dangerous because the SLICER is the next consumer: a stale "## Open questions" section can make the slicer re-treat answered questions as open, or duplicate them into slices.

## Solution

Apply must RECONCILE the body, not just append. When it folds in the answers it must also remove/supersede the content those answers resolve, so the resolved brief reads as RESOLVED.

Concretely, when applying answers that FULLY resolve the item (the `needsAnswers:false` route, not the re-pause route):

- **Remove the now-answered open-questions block.** The answers in `## Applied answers` supersede it. Because the section heading is author-controlled (this brief author used `## Open questions`, the template uses `## Open questions (clear needsAnswers when resolved)`), the reconciliation must be robust to the heading's exact text, not a hardcoded string match. Prefer a STRUCTURAL signal over a literal: the template should mark the transient block so apply can find and strip it deterministically (see decisions).
- **Neutralise the stale autonomy-note instruction.** The "Set `needsAnswers:true` ... clear once answered" line is AUTHORING guidance, not durable brief content. Either apply strips it, or (cleaner) the template keeps that instruction OUT of the durable body so there is nothing to reconcile.
- **Leave the re-pause route untouched.** When apply appends follow-up questions and KEEPS `needsAnswers:true` (the re-pause case), the open-questions block legitimately stays (it still has open questions). Reconciliation only fires on FULL resolution.

End state: after a full-resolution apply, the brief body contains the answers under `## Applied answers`, no leftover "these are still open" prose, and a truthful autonomy state.

## User Stories

1. As a reader of a resolved brief, I want its body to read as RESOLVED (answers present, no leftover open-questions section), so I do not have to cross-check the frontmatter flag to know it is answered.
2. As the slicer (the next consumer of a resolved brief), I want NO stale open-questions section in the body, so I never re-treat answered questions as open or duplicate them into slices.
3. As the apply rung, I want to reconcile the body on FULL resolution (strip the transient open-questions block + the stale autonomy note) while folding in the answers, so the durable record and the prose agree.
4. As the apply rung, I want the RE-PAUSE route (follow-up questions, `needsAnswers` stays true) to leave the open-questions block intact, so reconciliation never removes still-open questions.
5. As a brief author, I want a STRUCTURAL marker for the transient open-questions block (and the autonomy note kept out of the durable body), so apply can reconcile deterministically without guessing at author-controlled heading text.

### Autonomy notes (the two gate axes)

Omit both `humanOnly` and `needsAnswers`. The design is resolved (decisions below); this is a bounded, well-understood fix to one rung. Sliceable as-is.

## Implementation Decisions

- **Fix site:** `apply-persist.ts` `withAppliedAnswers` / the full-resolution body composition. Add a reconcile step that runs ONLY on the full-resolution route (not re-pause).
- **Structural marker over literal match (D1):** the brief/task TEMPLATE marks the transient open-questions block with a stable, machine-findable delimiter (e.g. an HTML comment fence `<!-- open-questions -->` ... `<!-- /open-questions -->`, mirroring how the sidecar already uses HTML-comment markers), so apply strips exactly that block regardless of the visible heading text. Falling back to a heading-regex is brittle and author-fragile; prefer the marker. Briefs/tasks authored WITHOUT the marker (older items) are left as-is by reconciliation (no marker => nothing to strip => same as today, no regression).
- **Autonomy note (D2):** keep the "Set needsAnswers:true ... clear once answered" instruction OUT of the durable body (it is template/authoring guidance). Move it to a template COMMENT (not rendered durable prose) so there is nothing stale to reconcile. (If it must stay visible while authoring, fence it with the same transient marker so apply strips it too.)
- **Re-pause untouched (D3):** the reconcile step is gated on the resolve-fully disposition; the append-follow-up-questions / re-pause route keeps today's behaviour exactly.
- **Template + protocol mirror:** the marker convention is added to `skills/setup/protocol/brief-template.md` and `task-template.md`, mirrored byte-identical into `work/protocol/` (the two-place protocol discipline, see `AGENTS.md`).

## Testing Decisions

- A full-resolution apply on an item whose body has a marker-fenced open-questions block: assert the block is GONE and `## Applied answers` is present (the resolved-reads-as-resolved invariant).
- A RE-PAUSE apply (follow-up questions appended, `needsAnswers` stays true): assert the open-questions block is RETAINED (reconciliation did not fire).
- An item with NO marker (older/un-fenced): assert apply behaves exactly as today (no strip, no crash), backward compatible.
- The frontmatter/sidecar invariants (`needsAnswers:false <=> sidecar deleted`) stay green (do not regress the existing apply tests).
- Tests use throwaway git repos (the existing apply-rung test pattern).

## Out of Scope

- Changing WHAT apply records (the answers content) or the frontmatter/sidecar invariant. Only the body reconciliation around it is in scope.
- Retro-fixing already-applied briefs that carry the stale block (e.g. `staging-surface-and-apply-promote-safety`). A one-time manual cleanup of that brief can ride this work or be done by hand; it is not the mechanism fix.
- The triage/keep/drop body-stamping routes (this is the resolve-answers route only).

## Further notes

The already-applied `staging-surface-and-apply-promote-safety` brief currently carries the stale `## Open questions` block. Hand-cleaning it (or letting this fix's author clean it as a demonstration) is fine, but the brief still slices correctly today because its `## Applied answers` section carries the real decisions; the risk this brief fixes is the slicer misreading the stale block, so cleaning it before it is sliced is prudent.
