---
title: Surface promote-prd as a human-only disposition (never auto-picked)
slug: surface-promote-prd-as-human-only-disposition
prd: observation-discharge-by-deletion-self-contained-promotion-and-prd-route
blockedBy: [promote-prd-disposition-and-triage-local-cas-prd-writer]
covers: [5]
---

## What to build

Offer `promote-prd` to the human at the triage/surface question (alongside
`promote-task`), and guarantee the `observationTriage: auto` gate NEVER picks it.

End-to-end behaviour:

- When an observation's triage question is surfaced to a human, `promote-prd`
  appears as one of the choosable dispositions next to `promote-task` (so a
  human who judges a signal PRD-sized can route it to a spec in-loop).
- The `observationTriage: auto` gate continues to NEVER auto-promote at all
  (today it only auto-disposes the no-question `duplicate`/`map` cases). Add an
  explicit guard/assertion that `promote-prd` is reachable ONLY via a human
  answer, never as an auto-disposition. Sizing an initiative (task vs PRD) is a
  human judgement call.

## Acceptance criteria

- [ ] The surfaced triage question presents `promote-prd` as a human-choosable
      disposition alongside `promote-task`.
- [ ] `observationTriage: auto` cannot emit `promote-prd` (assert it is never an
      auto-disposition; the auto gate still never auto-promotes).
- [ ] Tests cover both: a human answer routes `promote-prd`; the auto gate never
      does.

## Blocked by

- `promote-prd-disposition-and-triage-local-cas-prd-writer` — the disposition
  and its writer must exist before the surface can offer it.

## Prompt

> Goal: make `promote-prd` a HUMAN-only disposition offered at the surface, never
> an auto-pick, per the PRD
> `observation-discharge-by-deletion-self-contained-promotion-and-prd-route`
> (Resolved decision 2 + US #5).
>
> Where to look (by concept): the surface/triage question that offers an
> observation's dispositions to a human (the surface-questions / triage-gate
> path); the `observationTriage` gate's auto-disposition logic (it already only
> auto-disposes `duplicate`/`map` and NEVER auto-promotes — keep that invariant
> and add `promote-prd` to the human-offered set only).
>
> Domain: `observationTriage` is the per-repo gate axis with `off | ask | auto`;
> `auto` auto-disposes only the no-question cases. `promote-prd` must sit on the
> human-answer side of that line, exactly like `promote-task` does — sizing a
> signal into a task vs a PRD is judgement.
>
> Seams to test at: the surface composition (asserts `promote-prd` is offered);
> the auto-disposition gate (asserts it never returns `promote-prd`, never
> auto-promotes). Mirror existing triage-gate / surface tests.
