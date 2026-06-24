---
title: Amend WORK-CONTRACT.md to sanction deletion-on-apply as note discharge
slug: work-contract-sanction-deletion-on-apply-discharge
prd: observation-discharge-by-deletion-self-contained-promotion-and-prd-route
blockedBy: []
covers: [6]
---

## What to build

Amend the work contract so deletion-on-apply is stated as the explicit, correct
way an answered observation is discharged — so the "never auto-delete a signal"
clause is not misread as barring it.

End-to-end behaviour:

- Edit WORK-CONTRACT.md (the capture-bucket discharge rules around L65/L67) to
  state: when the apply/triage rung applies a human's RATIFIED answer
  (promote/dropped), it DELETES the note in the same discharge — this is
  human-authored deletion (the human said promote/drop), NOT the agent
  unilaterally destroying a live signal. The "never auto-delete a signal; a
  human deletes" clause means the agent must not delete an UN-dispositioned note;
  it does not bar deletion-on-apply of a dispositioned one.
- Reconcile any neighbouring prose (e.g. the `## Recommended: delete`
  human-janitorial-step description) so it no longer implies a `triaged:`/
  resting-state is a legitimate resting position for a discharged note.
- This is a PROTOCOL-DOC edit: per AGENTS.md, edit the SOURCE
  `skills/setup/protocol/WORK-CONTRACT.md` and mirror BYTE-IDENTICALLY into
  `work/protocol/WORK-CONTRACT.md` (`diff -r skills/setup/protocol work/protocol`
  must stay clean). Editing only the `work/protocol/` copy silently drifts and
  the next `setup` reverts it.

## Acceptance criteria

- [ ] WORK-CONTRACT.md states deletion-on-apply explicitly (human's ratified
      answer authorises the delete) and that the "never auto-delete" clause does
      not bar it.
- [ ] No prose remains implying a discharged note may REST `triaged:`/
      `needsAnswers:false` in the inbox.
- [ ] The SOURCE (`skills/setup/protocol/`) and MIRROR (`work/protocol/`) copies
      are byte-identical (`diff -r skills/setup/protocol work/protocol` clean for
      this file).
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`
      (docs-only, but the format gate covers markdown).

## Blocked by

- None — can start immediately. (Docs-only; file-orthogonal to all code tasks.)

## Prompt

> Goal: amend WORK-CONTRACT.md so deletion-on-apply is the sanctioned discharge
> for an answered observation, per the PRD
> `observation-discharge-by-deletion-self-contained-promotion-and-prd-route`
> (US #6) and the maintainer ruling (2026-06-24).
>
> Where to look: the capture-bucket discharge rules in WORK-CONTRACT.md (around
> the L65/L67 "notes leave by deletion" / "no resolved-and-kept note" clauses and
> the "never auto-delete a signal; a human deletes" clause). State the
> reconciliation: deletion-on-apply is human-AUTHORED (the apply rung runs the
> human's ratified promote/drop answer), so it satisfies "a human deletes" — the
> clause only ever barred the agent from deleting an UN-dispositioned note.
>
> CRITICAL (AGENTS.md): this repo is both the AUTHOR and a USER of the protocol.
> Edit the SOURCE OF TRUTH `skills/setup/protocol/WORK-CONTRACT.md`, then mirror
> the identical change into `work/protocol/WORK-CONTRACT.md` so the two stay
> byte-identical. Editing the `work/protocol/` copy alone drifts it and the next
> `setup` propagates the OLD source text.
>
> "Done" = the contract sanctions deletion-on-apply, no resting-state prose
> remains for notes, the two copies are byte-identical, and the acceptance gate
> is green (`pnpm -r build && pnpm -r test && pnpm format:check`).
