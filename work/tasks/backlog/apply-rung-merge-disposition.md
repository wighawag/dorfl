---
title: Apply-rung — answered merge-question invokes the land primitive (conditional, refuses on red re-verify)
slug: apply-rung-merge-disposition
prd: land-time-reverify-and-parallel-merge-ceiling
needsAnswers: true
blockedBy: [merge-question-surfacer]
covers: [15, 16]
---

## What to build

When a merge-question's sidecar is ANSWERED, dispatch the answered
merge through the EXISTING land primitive in `integration-core.ts`
(rebase onto current `main` -> re-run `verify` on the rebased tip ->
advance). This is the closure of the propose PR-merge-time gap for the
bare / no-host floor: the runner becomes the merger via the
surface->answer->apply rungs, NOT a bespoke `land`/`merge-pr` verb.

NOTE (mechanism drifted — see Open questions): this task was authored
to "extend the apply rung's `promote-slice`/`dropped` disposition-
dispatch in `triage-persist.ts`". That disposition-dispatch, its
picker, and the disposition vocabulary were REMOVED by the keystone
`agentic-question-resolution-retire-disposition-vocabulary`. Apply is
now the agentic `decide(input, allowedOutcomes) -> {task | prd | adr |
delete | ask}` (`apply-decide.ts` / `decision-engine.ts`), and "land
this merge" is NOT a `decide()` content outcome. So the answered-merge
land must be a DISTINCT answer-driven runner-ACTION dispatch layer
(keyed off the merge-question's identity + the human's answer), a
SIBLING of the agentic content decision — not an entry in the
`DecisionOutcome` union. Resolve the exact seam in the Open questions
below before building.

Two non-negotiable behaviours:

- An answered-merge is CONDITIONAL: apply re-verifies on the rebased
  tip and REFUSES on red (routes to needs-attention or re-surfaces the
  question), NEVER lands a clean-rebase-but-broken tree.
- Reuse the existing apply-rung wiring (sidecar answered-ness gate,
  the same commit/route machinery) — add a runner-action branch, do
  NOT re-introduce a disposition field and do NOT duplicate the land
  primitive.

## Open questions (needsAnswers)

OQ-A (mechanism, NEW — disposition vocabulary retired): where does the
answer-driven LAND action live now that there is no disposition
dispatch? Confirm the runner-action-dispatch-layer direction from
`work/notes/observations/merge-question-tasks-premised-on-retired-disposition-vocabulary-2026-06-25.md`:
the answered merge-question is recognised by its question IDENTITY
(type/kind), the human's answer selects merge/hold/drop, and a
runner-action handler invokes the land primitive — it is NOT routed
through `decide()`'s content-outcome union. Confirm this is a sibling
dispatch to the agentic content decision, and whether the sibling
stuck-lock requeue action shares the SAME layer (resolve once).

OQ6 (prd, still open): when `main` moved between the human's answer
and the apply step but the rebased tip STILL verifies GREEN, does apply

  (a) HONOUR the prior approval and land — cheap; trusts that a green
      re-verify is sufficient (the prd calls this the likely default);
      or
  (b) RE-SURFACE the question because the merge-base CHANGED — the
      host-agnostic analogue of GitHub's "dismiss stale approvals when
      the base changes"; (b) becomes an opt-in strictness on top of (a).

Decide BEFORE building this task. Sub-question: if both ship (a+b
opt-in), what flag/config axis controls (b), and what is its default?

Do NOT build until OQ-A and OQ6 are answered. (OQ7's outcome — the
merge-questions gate name/default — does not block THIS task; it gates
WHETHER the surfacer runs, not what the dispatch does.)

## Acceptance criteria

- [ ] needsAnswers is cleared (OQ-A mechanism + OQ6 policy answered)
      before this is built.
- [ ] Apply dispatches an answered merge-question through the existing
      land primitive (rebase -> re-verify -> advance) via a
      runner-ACTION handler (keyed off the question identity + answer),
      NOT a disposition token and NOT the `decide()` content-outcome
      union.
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

> Do NOT build until OQ-A (mechanism) and OQ6 (policy) are answered —
> the disposition-dispatch this task was authored against was retired.
> Once answered: read Stories 15-16, the relevant Implementation
> Decision in the prd, the observation
> `merge-question-tasks-premised-on-retired-disposition-vocabulary-2026-06-25.md`,
> the keystone done record `agentic-apply-retire-disposition-vocabulary.md`,
> and the current apply rung (`apply-persist.ts` / `apply-decide.ts` /
> `decision-engine.ts`). Add the answered-merge LAND as a runner-ACTION
> dispatch (sibling to the agentic content decision; keyed off the
> merge-question identity + the human's answer), NOT a `DecisionOutcome`
> and NOT a revived disposition field. Invoke the LAND primitive via the
> existing `integration-core.ts` `performIntegration` — do NOT
> re-implement rebase/verify/advance. Tests must hit external behaviour
> (what lands on `main`, what routes to needs-attention) and prove
> `verify` ran on the rebased tip. Run the AGENTS.md acceptance gate.
