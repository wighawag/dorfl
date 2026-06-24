---
title: Advance surfacer — emit MERGE-QUESTIONS for unmerged `work/*` branches (+ `gh pr list` ceiling)
slug: merge-question-surfacer
prd: land-time-reverify-and-parallel-merge-ceiling
blockedBy: []
covers: [14]
---

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

Scope of this slice:

- The enumerator: `work/*` branches whose tip is not reachable from
  `main` (the floor), augmented with PR metadata via `gh pr list` where
  a GitHub remote is configured (the ceiling rendering).
- The sidecar emit: same shape as existing surfacers; disposition
  vocabulary `merge | hold | drop`. Sidecar identity-keyed
  (per `work/questions/<type>-<slug>.md` convention).
- PR-OPTIONAL by construction: works on a bare `--bare` arbiter with
  `NoneProvider`.

OUT OF SCOPE for THIS slice (separate slices):

- The apply-rung dispatch for an answered `merge` disposition
  (`apply-rung-merge-disposition`).
- The gate axis that gates this surfacer's invocation
  (`merge-questions-gate-axis`).
- The cross-cutting questions in the prd's "Part of a larger
  generalization" section (sidecar-keying, questions-folder shape) —
  those are see-also, not in this prd's scope.

## Acceptance criteria

- [ ] New surfacer enumerates unmerged `work/*` branches by reachability
      against `main`; adds PR metadata when a GitHub host is configured.
- [ ] Surfacer emits merge-questions into the existing sidecar shape
      with `merge | hold | drop` disposition vocabulary.
- [ ] Surfacer works on a bare arbiter (no host required).
- [ ] Existing `surface-questions` judgement skill is untouched.
- [ ] Tests cover: a no-host bare arbiter, a GitHub-configured
      arbiter (mocked `gh pr list`), and the empty case (no unmerged
      branches → no questions emitted).
- [ ] Tests isolate global locations per task-template rule.
- [ ] Acceptance gate green.

## Blocked by

- None — file-orthogonal from engine and CI-template slices; rides on
  the advance-loop surfacer machinery already in `tasks/done/`
  (`advance-rung-surface.md`, `advance-sidecar-contract.md`).

## Prompt

> Read Story 14 + Applied Answer q2 + the finding `advance-surface-
> apply-rungs-can-carry-merge-questions-for-unmerged-branches-2026-06-
> 21.md`. Read the existing surfacer implementations (the rungs in
> `advance-rung-surface.md`'s landed code, the sidecar contract from
> `advance-sidecar-contract.md`) to mirror their pattern exactly — this
> slice is a clean INSTANCE of the general surface→answer→apply shape,
> not a bespoke verb. Build the floor (reachability) first; layer the
> `gh pr list` ceiling on top as enrichment only. Tests must not hit
> real GitHub. Run the AGENTS.md acceptance gate.
