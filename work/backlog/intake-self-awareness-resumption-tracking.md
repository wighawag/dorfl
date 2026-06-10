---
title: intake-self-awareness-resumption-tracking — intake must recognise its OWN prior comments (a marker + author self-filter) so it never re-triggers on / re-processes its own turns, and the decision prompt knows what it already did
slug: intake-self-awareness-resumption-tracking
prd: issue-intake
blockedBy: []
covers: [2, 10]
---

> Derives from the `issue-intake` PRD (the ASK loop "resumes from the updated thread"; US #2 = ask-until-clear via conversation; US #10 = serialise concurrent runs). Surfaced 2026-06-10 while specifying the completion-comment slice: intake has NO concept of its own prior turns, which is a latent loop hazard for the ASK loop TODAY (not just for the new completion comment).

## What to build

Intake is stateless per run: the decision prompt (`buildIntakeDecisionBrief`, `src/intake.ts`) is handed the WHOLE comment thread with **no high-water mark and no idea which comments are intake's own**. There is **no marker, no bot-identity concept, and no persisted cursor** anywhere in intake (verified 2026-06-10). And `classifyIntakeEvent` (`src/intake-event.ts`) maps EVERY `issue-comment-created` to `re-evaluate` — with NO author/self filter.

Consequence (a real, pre-existing hazard): every comment intake POSTS (the ASK question, the BOUNCE message — and the proposed completion comment) is itself an `issue-comment-created`. If a CI trigger re-runs intake on new comments, **intake's own comment re-triggers intake**, which re-reads the thread and may re-ask / re-process → a loop. Today it only "works" because the prompt re-derives conversation state every run by re-reading everything — fragile, and it cannot tell "I already asked this" from "the user answered".

Give intake SELF-AWARENESS so it never acts on its own turns and the prompt knows what it already did. TWO complementary mechanisms (author alone is not enough):

1. **A machine-readable MARKER on every comment intake posts** — a hidden HTML comment tag, e.g. `<!-- agent-runner:intake kind=ask -->` / `<!-- agent-runner:intake kind=bounce -->` (and, once the completion-comment slice lands, `kind=created slug=<slug> -->`). The marker is provider-PORTABLE (survives even if intake posts under a human's token, where author-identity fails) and lets a stateless re-run recover "what did I already do" — including the TERMINAL "already created an artifact for this issue, do not re-process".
2. **Author/marker self-filter in event classification** — a new `issue-comment-created` whose author is intake's own identity OR whose body carries the intake marker classifies as `ignore` (it is intake's own turn, not a new user turn). This closes the self-trigger loop at the event layer.

Feed intake's prior turns to the DECISION PROMPT: the brief should distinguish "intake's prior comments (marker-tagged)" from "user comments", so the prompt does not re-ask a question it already asked, and treats a prior `kind=created` marker as "this issue was already transformed — do nothing" (the resumption / idempotency the ASK loop needs).

This is the foundation the completion-comment slice (`intake-posts-completion-comment-on-slice-prd-outcomes`) depends on, but it stands alone: it fixes the ASK/BOUNCE self-loop that already exists.

## Acceptance criteria

- [ ] Every comment intake posts (ask, bounce) carries a machine-readable intake MARKER (a hidden HTML comment), asserted at the stubbed issue seam.
- [ ] `classifyIntakeEvent` classifies a new comment authored by intake's own identity OR bearing the intake marker as `ignore` (not `re-evaluate`); a test pins it (so intake cannot self-trigger).
- [ ] The decision brief distinguishes intake's OWN prior turns (marker-tagged) from user turns, and treats a prior `created` marker as "already transformed — do nothing" (idempotent re-run); covered by a dispatcher / brief test (the prompt JUDGEMENT itself is not unit-tested, per the PRD).
- [ ] Author-identity resolution is provider-pluggable through the issue seam (no `gh` import in core); a non-identifying provider still gets self-filtering via the marker.
- [ ] No new persisted state / cursor file — recovery is from the thread (the marker) only (status = the thread, not a sidecar; consistent with the contract's "no shared index" spirit).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None — can start immediately (it fixes existing intake; it does not depend on the `issue:`-field or completion-comment slices).

## Open questions (needsAnswers — resolve before building)

The mechanism is decided (marker + author self-filter); these shape it:

- **Identity source:** is intake's "own identity" the authenticated `gh` user (`gh api user`), a configured bot login, or do we rely on the MARKER alone and skip author-identity entirely (simpler, fully provider-portable)? Lean: marker-first, author as a best-effort secondary — but confirm.
- **Marker placement/format:** a trailing `<!-- agent-runner:intake … -->` HTML comment is invisible in rendered GitHub and parseable. Confirm that is the desired shape (vs a visible footer line).

(These are small; flagged so the builder does not guess the identity model.)

## Prompt

> Give intake SELF-AWARENESS so it never re-triggers on or re-processes its own comments, and the decision prompt knows its own prior turns. PRD: `work/prd-sliced/issue-intake.md`. This fixes a PRE-EXISTING hazard: every comment intake posts is an `issue-comment-created`, and `classifyIntakeEvent` re-evaluates ALL of those with no self-filter → intake's own ask/bounce can re-trigger intake.
>
> DRIFT CHECK FIRST: confirm there is still NO marker / bot-identity / cursor in `src/intake.ts` + `src/intake-event.ts`, and that `classifyIntakeEvent` maps `issue-comment-created` → `re-evaluate` unconditionally. If a self-filter already exists, re-scope this slice.
>
> WHAT TO BUILD: (1) stamp a hidden machine-readable MARKER on every comment intake posts (ask, bounce); (2) make `classifyIntakeEvent` `ignore` a new comment that is intake's own (by marker, and optionally by author identity via the seam); (3) feed "intake's prior marker-tagged turns vs user turns" to `buildIntakeDecisionBrief`, and treat a prior `created` marker as "already transformed — do nothing".
>
> RESOLVE THE OPEN QUESTIONS FIRST (identity source; marker format) — they are in the slice body; do not guess the identity model.
>
> SCOPE FENCE: no persisted cursor/sidecar (recover from the thread/marker only); core never imports `gh` (author identity resolves through the issue seam). Do NOT build the completion comment here (that is the dependent slice) — but DO make the marker mechanism reusable so that slice just adds a `created` marker.
>
> SEAM TO TEST AT: the stubbed issue seam (`postIssueComment` records the marker)
>
> - `classifyIntakeEvent` (own-comment → ignore) + the brief (own vs user turns). Mirror the existing intake + intake-event tests.
>
> "Done" = intake stamps + recognises its own comments, cannot self-trigger, re-runs idempotently on an already-transformed issue, and `pnpm -r build && pnpm -r test && pnpm format:check` is green.
