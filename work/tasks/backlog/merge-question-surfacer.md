---
title: Advance surfacer — emit MERGE-QUESTIONS for unmerged `work/*` branches (+ `gh pr list` ceiling)
slug: merge-question-surfacer
prd: land-time-reverify-and-parallel-merge-ceiling
needsAnswers: true
blockedBy: []
covers: [14]
---

## Open questions (needsAnswers — disposition vocabulary was retired)

This task was authored against the SIDECAR DISPOSITION VOCABULARY
(`merge | hold | drop`), which the keystone PRD
`agentic-question-resolution-retire-disposition-vocabulary` RETIRED. A
sidecar entry is now BINARY (`no-answer | answered`); there is no
`disposition=` field to emit into, and apply is the agentic
`decide(input, allowedOutcomes) -> {task | prd | adr | delete | ask}`
(see `decision-engine.ts`). "Land this merge" is NOT one of those
content outcomes.

The re-decompose direction (sketched in
`work/notes/observations/merge-question-tasks-premised-on-retired-disposition-vocabulary-2026-06-25.md`):
treat answer-driven runner ACTIONS (merge/land, and the sibling
stuck-lock requeue) as a DISTINCT dispatch layer keyed off the surfaced
question's IDENTITY + the human's plain answer, rather than forcing
`merge` into the `decide()` content-outcome union.

Resolve BEFORE building:

1. Does a merge-question emit a PLAIN binary sidecar entry (the
   surfacer's job is only to enumerate + surface), with the
   merge/hold/drop CHOICE carried as the human's free-text answer that
   the (separate) apply-action layer interprets? Confirm the surfacer
   emits NO disposition token (there is none to emit).
2. The two cross-cutting questions SHARED with the stuck-lock surfacer
   sibling, which must be answered ONCE across both (see the prd's
   "Part of a larger generalization"): (i) can a sidecar key to a
   LOCK-REF / BRANCH identity, not only a `work/<slug>.md` path? (an
   unmerged branch may have no item body); (ii) the questions-folder
   shape/name.

Do NOT build until these are answered and the disposition-vocabulary
language below is reconciled.

## What to build

A SECOND, state-sourced surfacer in the advance loop that enumerates
unmerged `work/*` branches by reachability against `main` (the git-alone
FLOOR) and, where a host exists, open PRs via `gh pr list` (the CEILING
rendering). Each is emitted as a MERGE-QUESTION into the SAME sidecar
shape used by existing surface→answer→apply flows, with a disposition
choice of `merge | hold | drop`.

The judgement `surface-questions` skill is UNTOUCHED — this surfacer is
state-sourced, not judgement-sourced. It is a clean SIBLING to the
existing surfacers (observation triage, judgement spec-surface, stuck-
lock surfacing per the sibling generalisation), not a bespoke verb.

Scope of this task:

- The enumerator: `work/*` branches whose tip is not reachable from
  `main` (the floor), augmented with PR metadata via `gh pr list` where
  a GitHub remote is configured (the ceiling rendering).
- The sidecar emit: same shape as existing surfacers; a BINARY entry
  (no-answer | answered), NOT a disposition token (the disposition
  vocabulary was retired — see Open questions). The merge/hold/drop
  CHOICE is the human's answer text, interpreted later by the apply
  action layer (`apply-rung-merge-disposition`). Sidecar identity-keyed
  (per `work/questions/<type>-<slug>.md` convention).
- PR-OPTIONAL by construction: works on a bare `--bare` arbiter with
  `NoneProvider`.

OUT OF SCOPE for THIS task (separate tasks):

- The apply-rung dispatch for an answered merge-question
  (`apply-rung-merge-disposition`).
- The gate axis that gates this surfacer's invocation
  (`merge-questions-gate-axis`).
- The cross-cutting questions in the prd's "Part of a larger
  generalization" section (sidecar-keying, questions-folder shape) —
  those are see-also, not in this prd's scope.

## Acceptance criteria

- [ ] needsAnswers is cleared (the disposition-vocabulary open questions
      above are answered) before this is built.
- [ ] New surfacer enumerates unmerged `work/*` branches by reachability
      against `main`; adds PR metadata when a GitHub host is configured.
- [ ] Surfacer emits merge-questions as BINARY sidecar entries (no
      disposition token); the merge/hold/drop choice rides the human's
      answer text, not a `disposition=` field.
- [ ] Surfacer works on a bare arbiter (no host required).
- [ ] Existing `surface-questions` judgement skill is untouched.
- [ ] Tests cover: a no-host bare arbiter, a GitHub-configured
      arbiter (mocked `gh pr list`), and the empty case (no unmerged
      branches → no questions emitted).
- [ ] Tests isolate global locations per task-template rule.
- [ ] Acceptance gate green.

## Blocked by

- None — file-orthogonal from engine and CI-template tasks; rides on
  the advance-loop surfacer machinery already in `tasks/done/`
  (`advance-rung-surface.md`, `advance-sidecar-contract.md`).

## Prompt

> Do NOT build until the Open questions above are answered (the
> disposition vocabulary this task was authored against was retired).
> Once answered: read Story 14 + Applied Answer q2 + the finding
> `advance-surface-apply-rungs-can-carry-merge-questions-for-unmerged-branches-2026-06-21.md`,
> and the observation
> `merge-question-tasks-premised-on-retired-disposition-vocabulary-2026-06-25.md`.
> Read the existing surfacer implementations (the rungs in
> `advance-rung-surface.md`'s landed code, the sidecar contract from
> `advance-sidecar-contract.md`, and the current `decision-engine.ts` /
> `apply-decide.ts`) to mirror their pattern exactly — this task is a
> clean INSTANCE of the general surface->answer->apply shape over the
> BINARY sidecar, not a bespoke verb and not a disposition emitter. Build the floor (reachability) first; layer the
> `gh pr list` ceiling on top as enrichment only. Tests must not hit
> real GitHub. Run the AGENTS.md acceptance gate.
