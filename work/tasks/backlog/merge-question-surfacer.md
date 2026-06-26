---
title: Advance surfacer — emit MERGE-QUESTIONS for unmerged `work/*` branches (+ `gh pr list` ceiling)
slug: merge-question-surfacer
prd: land-time-reverify-and-parallel-merge-ceiling
needsAnswers: false
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

## Applied answers 2026-06-26

### q1: Does a merge-question emit a PLAIN binary sidecar entry (the surfacer's job is only to enumerate + surface), with the merge/hold/drop CHOICE carried as the human's free-text answer that the (separate) apply-action layer interprets? Confirm the surfacer emits NO disposition token (there is none to emit).

Yes, with one refinement to the suggested default. The surfacer emits a BINARY sidecar entry with NO disposition token (none exists). BUT the merge/hold/drop choice is NOT free-text — it is a DETERMINISTIC CHOICE shape (a fixed menu the human picks and the system parses unambiguously), distinct from the free-text answer box a content question uses. This is what lets the separate apply-action layer dispatch the land DETERMINISTICALLY without an agent run (PRD sidecar Q1 / `apply-rung-merge-disposition` Q3): a merge-acceptance has no judgement content, so the answer must be machine-parseable, not interpreted by an LLM. The surfacer's job is enumerate + surface (binary, plain, kind-tagged `merge`); the apply-action layer reads the kind + the chosen option and acts. So: binary entry, no token, deterministic-choice answer shape, kind=merge.

### q2: Can a sidecar key to a LOCK-REF / BRANCH identity, not only a `work/<type>-<slug>.md` path? An unmerged `work/*` branch may have no item body in the working tree (the branch tip carries the item, `main` does not), so the existing `work/questions/<type>-<slug>.md` convention may not be addressable from `main`.

Yes — extend the sidecar identity to a tagged union that permits a `branch:` / `ref:` (and `lock:` for the stuck-lock sibling) key in addition to `item:`, reflected in both the `item=` HTML comment and the filename. An unmerged-branch merge-question has no item body on `main`, so the branch ref is its stable identity. Resolve ONCE jointly with the stuck-lock surfacer (this is PRD sidecar Q5-i). LOAD-BEARING CONSTRAINT (from `questions-folder-rename-and-kind-axis-prefix-vs-subfolder` round-2 Q3): even a branch/ref-keyed sidecar must still be AUTHORED on `main`/runner under the `advancing` lock, NEVER against the work branch, or the 3-way-merge guarantee (stale sidecar content cannot survive a rebase) breaks.

### q3: What is the shape/name of the questions folder under the new identity scheme — does it stay `work/questions/<type>-<slug>.md`, or does it gain a branch/lock-ref-keyed sibling shape (e.g. `work/questions/branch--<sanitised-ref>.md`)?

For NOW: keep the flat `work/questions/` folder; item-keyed sidecars stay `work/questions/<type>-<slug>.md`, and add a sibling shape for branch/lock keys (e.g. `work/questions/branch-<sanitised-ref>.md`, `lock-<sanitised-ref>.md`) plus an explicit typed `kind` field (merge | stuck | triage | spec) in the identity comment — the kind is what the apply rung reads to choose deterministic-action vs agentic-content dispatch. LATER (intended direction, per `questions-folder-rename-and-kind-axis-prefix-vs-subfolder` + idea `folder-taxonomy-and-prd-edit-handshake`): group sidecars into kind-based SUBFOLDERS (`questions/merge/`, `questions/stuck/`, ...), safe because kinds are temporally mutually-exclusive per item and the subfolder is a pure function of (kind, identity). That restructure + any `questions/` rename is its OWN ADR-worthy decision tracked by `task:questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21`; do NOT fold it into this PRD. (PRD sidecar Q5-ii.)

### q4: Should this task be HELD out of the build pool until the parent PRD `land-time-reverify-and-parallel-merge-ceiling` is re-decomposed against the binary-sidecar / agentic-apply model, with this task's body language reconciled in the same pass?

The premise has now been RECONCILED in place (it does not need a separate re-decompose pass): the parent PRD `land-time-reverify-and-parallel-merge-ceiling` and all three merge-question task bodies have been amended in this pass against the binary-sidecar / deterministic-runner-action model (PRD sidecar Q1/Q2). This task's `## What to build` + scope bullet + acceptance criterion were already updated to drop the `merge | hold | drop` disposition-token language (replaced by "binary entry + deterministic-choice answer shape, no token") and to point at the runner-action apply layer. So: do NOT keep it premised on the retired vocabulary, and KEEP it in `tasks/backlog/` (not promoted) so it is built together with / before its siblings against the reshaped model. The observation `merge-question-tasks-premised-on-retired-disposition-vocabulary-2026-06-25` is discharged by this reconciliation (its signal now lives self-contained in the PRD + task bodies + these answers). needsAnswers clears once these answers apply.
