---
title: Apply-rung — answered merge-question invokes the land primitive (conditional, refuses on red re-verify)
slug: apply-rung-merge-disposition
prd: land-time-reverify-and-parallel-merge-ceiling
needsAnswers: false
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

## Applied answers 2026-06-26

### q1: What is your answer to PRD OPEN QUESTION 6 (the stale-approval policy)? When `main` moves between the human's answer and the apply step but the rebased tip STILL verifies GREEN, does apply (a) HONOUR the prior approval and land (cheap; trusts that a green re-verify is sufficient), or (b) RE-SURFACE the question because the merge-base CHANGED (the host-agnostic analogue of GitHub's 'dismiss stale approvals when the base changes')? And the sub-question: if both ship (a + b opt-in), what flag/config axis controls (b), and what is its default?

(a) HONOUR the prior approval and land when the rebased tip re-verifies GREEN, with (b) re-surface-on-changed-merge-base as an OPT-IN strictness layered on top. The opt-in (b) is controlled by a per-repo `strictMergeApproval` setting (resolved via the gate-family precedence chain: flag > env > per-repo > global > default), defaulting OFF, so the cheap green-re-verify-is-enough path is the default. On the binary sidecar, (b) clears the answer back to no-answer and re-surfaces the merge-question (authored on `main`/runner under the `advancing` lock, so no branch-side mutation). This matches PRD sidecar Q4. Story #16's RED-re-verify refusal is unchanged.

### q2: This task's premise appears STALE: it specifies mirroring the apply rung's `promote-slice`/`dropped` disposition-dispatch and dispatching an answered `merge` DISPOSITION, but that whole disposition vocabulary has since been RETIRED. Should this task be re-scoped (and re-reviewed) against the new AGENTIC apply model before it is built, or has its premise already been reconciled somewhere I have not seen?

Yes — the premise was stale (the disposition vocabulary is retired), and it has now been RECONCILED in this pass (see PRD sidecar Q1/Q2). The task body has been amended in place to the new model: do NOT mirror a `promote-slice`/`dropped` disposition-dispatch (gone) and do NOT route through the agentic `decide()`. Build the answered-merge land as a DETERMINISTIC runner-ACTION dispatch (see Q3). The task stays `needsAnswers: true` only until Q1 (policy) + Q3 (mechanism) here are applied.

### q3: Given the disposition vocabulary is retired and the agentic apply outcome set is `{task | prd | adr | delete | ask}` (a content-mint / delete / follow-up model), HOW should an answered merge-question dispatch the LAND primitive (rebase -> re-verify -> advance) within that model? It is a runner ACTION, not a content outcome, so it does not map onto any current `DecisionOutcome`. Does `merge` become a new agentic outcome wired only into the merge-question caller, a separate non-agentic state-action dispatch keyed off the merge-question's answer, or something else?

A SEPARATE, DETERMINISTIC answer-driven runner-ACTION dispatch layer — NOT a new `DecisionOutcome` and NOT a route through the agentic `decide()`. This is the keystone decision (PRD sidecar Q1): a merge-acceptance has no judgement content (the human's plain merge|hold|drop answer IS the decision; the correctness gate is the apply-time re-verify on the rebased tip, never an agent), so routing it through an LLM only adds cost and non-determinism.

Concretely, the apply rung gains a kind-check BEFORE the agentic decider:
```
apply(answered sidecar):
  if sidecar.kind is a runner-action kind (merge | stuck-requeue):
      dispatch deterministically from (kind, plain answer):
        answer=merge → performIntegration (rebase → re-verify → advance); refuse on red
        answer=hold  → leave as-is (no land)
        answer=drop  → route to the drop/cancel terminal
      # NO agent run
  else:                                   # observation / spec / triage
      verdict = decide(input, allowedOutcomes); route verdict   # agent, as today
```
The `kind` is read from the sidecar's typed identity field (PRD sidecar Q5-ii). The merge-question sidecar carries a deterministic CHOICE shape (merge|hold|drop) the human picks and the system parses unambiguously, distinct from the free-text content-question shape. The sibling stuck-lock requeue action SHARES this same runner-action layer (resolve once). Invoke the land via the EXISTING `integration-core.ts` `performIntegration` — do not re-implement rebase/verify/advance. Record the split as an ADR (working name `answered-question-dispatch-splits-runner-action-vs-agentic-content`).
