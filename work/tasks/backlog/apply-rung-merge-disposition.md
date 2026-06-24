---
title: Apply-rung — answered `merge` disposition invokes the land primitive (conditional, refuses on red re-verify)
slug: apply-rung-merge-disposition
prd: land-time-reverify-and-parallel-merge-ceiling
needsAnswers: true
blockedBy: [merge-question-surfacer]
covers: [15, 16]
---

## What to build

Extend the apply rung's existing disposition-dispatch (which today
handles `promote-slice`/`dropped` → `git mv`) to also dispatch an
answered `merge` disposition through the EXISTING land primitive in
`integration-core.ts` (rebase onto current `main` → re-run `verify` on
the rebased tip → advance). This is the closure of the propose
PR-merge-time gap for the bare / no-host floor: the runner becomes the
merger via the surface→answer→apply rungs, NOT a bespoke `land`/`merge-
pr` verb.

Two non-negotiable behaviours:

- An answered-merge is CONDITIONAL: apply re-verifies on the rebased
  tip and REFUSES on red (routes to needs-attention or re-surfaces the
  question), NEVER lands a clean-rebase-but-broken tree.
- Mirrors the existing disposition-dispatch shape — reuse, do not
  duplicate.

## Open questions (needsAnswers)

Prd OQ6 (still open): when `main` moved between the human's answer
and the apply step but the rebased tip STILL verifies GREEN, does apply

  (a) HONOUR the prior approval and land — cheap; trusts that a green
      re-verify is sufficient (the prd calls this the likely default);
      or
  (b) RE-SURFACE the question because the merge-base CHANGED — the
      host-agnostic analogue of GitHub's "dismiss stale approvals when
      the base changes"; (b) becomes an opt-in strictness on top of (a).

Decide BEFORE building this slice. Sub-question: if both ship (a+b
opt-in), what flag/config axis controls (b), and what is its default?

Do NOT build until OQ6 is answered. (OQ7's outcome — the merge-
questions gate name/default — does not block THIS slice; it gates
WHETHER the surfacer runs, not what the dispatch does.)

## Acceptance criteria

- [ ] Apply rung dispatches an answered `merge` through the existing
      land primitive (rebase → re-verify → advance), reusing the
      pattern from `promote-slice`/`dropped` dispatch.
- [ ] Stale approval policy implemented per the resolved OQ6 answer.
- [ ] A red re-verify on the rebased tip REFUSES the land and routes to
      needs-attention (or re-surfaces per policy); `main` never receives
      a tree that fails `verify`.
- [ ] Works on a bare arbiter with `NoneProvider` (no host required).
- [ ] Tests cover: green re-verify after stale main (per OQ6 policy);
      red re-verify on rebased tip (refusal); clean apply on a current
      `main` (lands).
- [ ] Tests isolate global locations.
- [ ] Acceptance gate green.

## Blocked by

- `merge-question-surfacer` — apply consumes the surfaced question's
  answer; the surfacer must exist first.

## Prompt

> Do NOT build until OQ6 is answered. Once answered: read Stories 15-16,
> the relevant Implementation Decision in the prd, and the apply-rung
> code (`advance-rung-apply.md` in `tasks/done/` will point to it).
> Mirror the `promote-slice`/`dropped` dispatch pattern in `triage-
> persist.ts`. Invoke the LAND primitive via the existing
> `integration-core.ts` `performIntegration` — do NOT re-implement
> rebase/verify/advance. Tests must hit external behaviour (what lands
> on `main`, what routes to needs-attention) and prove `verify` ran on
> the rebased tip. Run the AGENTS.md acceptance gate.
