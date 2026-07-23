---
title: 'Fix WORK-CONTRACT.md:70 disposition-vocabulary coherence nits'
slug: review-nits-work-contract-sanction-deletion-on-apply-discharge-2026-06-24
needsAnswers: false
blockedBy: []
---

## What to build

Fix the doc-coherence nits on the deletion-on-apply bullet at
`skills/setup/protocol/WORK-CONTRACT.md:70` (and its byte-identical mirror
`work/protocol/WORK-CONTRACT.md`). Two nits to fix, one to verify:

1. **Drop the `duplicate` pseudo-disposition.** The bullet pairs
   `dropped`/`duplicate` as if `duplicate` were a standalone disposition, but
   `duplicate` is NOT a disposition — it is a REASON recorded in the item body
   under the generic `dropped` terminal (WORK-CONTRACT L31/L67; SURFACE-PROTOCOL
   L58). Rephrase as `dropped` (with `duplicate`/other reason) so a contributor
   does not read `duplicate` as first-class.
3. **Anchor the self-quoted clause.** The bullet quotes "the 'never auto-delete a
   signal; a human deletes' clause" as if that exact wording exists verbatim
   elsewhere in the contract — it does not; the CONCEPT lives at L72 ("a note
   annotated 'resolved' and kept is a contradiction... discharge it by deleting
   it") and the bucket table. Anchor the reference to the actual L72 wording so a
   reader searching for the quoted phrase finds it.

(Nit #2 from the original review — the `promote-spec` forward-reference — is now
STALE: `promote-spec` has since landed in the disposition set, so the contract no
longer forward-references a non-existent disposition. Verify this is consistent
and drop the nit.)

This is a PROTOCOL-DOC edit: edit the SOURCE `skills/setup/protocol/` and mirror
BYTE-IDENTICALLY into `work/protocol/` (AGENTS.md).

## Acceptance criteria

- [ ] The bullet no longer presents `duplicate` as a disposition (it reads as a
      reason under `dropped`).
- [ ] The self-quoted "never auto-delete" clause is anchored to the real L72
      wording (or rephrased to it).
- [ ] The `promote-spec` reference is verified consistent with the now-landed
      disposition set.
- [ ] SOURCE and MIRROR copies of WORK-CONTRACT.md are byte-identical
      (`diff -r skills/setup/protocol work/protocol` clean for this file).
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- None — can start immediately.

## Prompt

> Goal: fix the disposition-vocabulary coherence nits on the deletion-on-apply
> bullet at WORK-CONTRACT.md:70.
>
> Where to look: `skills/setup/protocol/WORK-CONTRACT.md:70` (the deletion-on-
> apply bullet) vs `SURFACE-PROTOCOL.md:58` (the disposition set) and
> WORK-CONTRACT L31/L67/L72. (1) `duplicate` is a REASON under `dropped`, not a
> disposition — rephrase. (2) anchor the self-quoted "never auto-delete a signal;
> a human deletes" clause to the real L72 wording. (3) verify the `promote-spec`
> reference is now consistent (it has since landed) and drop the stale
> forward-reference nit.
>
> CRITICAL (AGENTS.md): edit the SOURCE `skills/setup/protocol/WORK-CONTRACT.md`
> and mirror the identical change into `work/protocol/WORK-CONTRACT.md`; the two
> must stay byte-identical (`diff -r` clean). FIRST read current reality — the
> disposition vocabulary is changing (an agentic-resolution SPEC is retiring much
> of it), so confirm the surrounding text before editing and keep the fix
> consistent with what actually landed. Keep the gate green.
