---
title: intake event-classification — new-comment / issue-body-edited → re-evaluate; buried comment-edit ignored (pure control-path logic)
slug: intake-event-classification
prd: issue-intake
blockedBy: []
covers: [2]
---

## What to build

A PURE event-classification function: given an issue event, decide whether `intake` should RE-EVALUATE the whole thread or IGNORE the event. This is the control-path logic the engine's re-run depends on (and that CI's trigger later consults — CI's trigger POLICY itself is `runner-in-ci`'s, out of scope here).

The canonical rule (from the PRD):

- A **new comment** OR an **issue-body edit** → RE-EVALUATE the whole thread (re-read body + full thread; edit-vs-reply changes only the comment's framing, not the control path).
- Editing a **buried PRIOR comment** is IGNORED — it is NOT a new turn (re-triggering on old-comment edits invites loops).

This is pure, file-orthogonal logic over an event shape — no seam, no git, no `gh`. It has no dependency on the command/seam/dispatcher modules, so it can be built independently and in parallel with the rest of the `issue-intake` set.

## Acceptance criteria

- [ ] Pure classifier: given an event (new-comment / issue-body-edited / prior-comment-edited / …), returns whether to RE-EVALUATE or IGNORE.
- [ ] new-comment ⇒ re-evaluate; issue-body-edited ⇒ re-evaluate; buried prior-comment-edited ⇒ ignore (asserted as a table).
- [ ] Edit-vs-reply does NOT change the control path (a new comment re-evaluates whether it is an edit-framed or reply-framed comment).
- [ ] No seam / git / `gh` touched (pure logic, stubbed events).
- [ ] Tests mirror the repo's existing pure-logic test style.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — pure, standalone module; orthogonal to the seam/dispatcher files. Can start immediately, in parallel with the rest of the `issue-intake` set. (It is the control-path classifier the engine's re-run — and later CI's trigger — consults.)

## Prompt

> Build `intake`'s PURE event-classification logic: given an issue event, decide RE-EVALUATE vs IGNORE (US #2 — the resume-on-thread-change behaviour).
>
> THE CANONICAL RULE (from `work/prd-sliced/issue-intake.md`):
>
> - a NEW COMMENT or an ISSUE-BODY EDIT → RE-EVALUATE the whole thread (re-read body + full thread; edit-vs-reply changes only the comment's framing, not the control path);
> - editing a BURIED PRIOR COMMENT is IGNORED (not a new turn — re-triggering on old-comment edits invites loops).
>
> WHAT TO BUILD: a pure classifier over an event shape returning RE-EVALUATE / IGNORE per the rule. No seam, no git, no `gh` — pure logic. This is the control-path classifier the engine's re-run depends on (CI's trigger later consults it; CI's trigger POLICY is `runner-in-ci`'s, NOT here).
>
> SEAM TO TEST AT: the pure classifier (a table of event kinds → re-evaluate/ignore). Stub the event shapes; no network.
>
> SCOPE FENCE: ONLY the pure classifier. Do NOT build CI's trigger policy (command/every-issue, maintainer/anyone) — that is `runner-in-ci`. Do NOT wire it into a real webhook/CI path (no CI here). Do NOT touch the seam, dispatcher, lock, mode KNOBS, or the "PRD complete?" query.
>
> FIRST run the drift check: confirm no event-classification logic already exists in `packages/dorfl/src`. If it does, reconcile against it; if a premise is broken, route to `needs-attention/` with the discrepancy.
>
> "Done" = the classifier returns re-evaluate for new-comment / body-edit and ignore for a buried comment-edit, edit-vs-reply doesn't change the path, it is pure (no seam/git/gh), and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.
