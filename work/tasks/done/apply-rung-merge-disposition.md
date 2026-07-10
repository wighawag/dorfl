---
title: Apply-rung — answered merge-question invokes the land primitive (conditional, refuses on red re-verify)
slug: apply-rung-merge-disposition
spec: land-time-reverify-and-parallel-merge-ceiling
needsAnswers: false
blockedBy: [merge-question-surfacer, sidecar-kind-field, committed-recovery-honours-fresh-worktree-gate, strict-merge-approval-gate]
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
now the agentic `decide(input, allowedOutcomes) -> {task | spec | adr |
delete | ask}` (`apply-decide.ts` / `decision-engine.ts`), and "land
this merge" is NOT a `decide()` content outcome. So the answered-merge
land must be a DISTINCT answer-driven runner-ACTION dispatch layer
(keyed off the merge-question's identity + the human's answer), a
SIBLING of the agentic content decision — not an entry in the
`DecisionOutcome` union. Resolve the exact seam in the Open questions
below before building.

SCOPE (narrowed 2026-06-26 after the build agent stopped — see
"Applied answers" q4): this task is the DISPATCH LAYER + the
WORKTREE/CHECKOUT SEAM + the verify-on-rebased-tip REFUSAL. Two
load-bearing pieces the original scope ASSUMED the engine already did
are carved into their own preceding tasks (both are now `blockedBy`):

- the committed-recovery tail re-verifying on the rebased tip is NOT
  what `performIntegration` does today on the answered-merge state
  (`committedRecovery` deliberately SKIPS the fresh gate) -> fixed by
  `committed-recovery-honours-fresh-worktree-gate`;
- the `strictMergeApproval` opt-in (OQ6's re-surface-on-changed-
  merge-base) is a new user-visible config axis -> carved into
  `strict-merge-approval-gate`. Until it lands, hard-code the default
  (OFF = honour the prior answer + land on a green re-verify).

WORKTREE/CHECKOUT SEAM (item the original scope left unnamed): the
apply rung runs on `main`; the unmerged `work/<slug>` branch must be
checked out before `performIntegration` can rebase/re-verify/integrate
its tip. Use the EXISTING per-job worktree seam in `workspace.ts`
(`createJob` -> `git worktree add` a worktree OFF the hub mirror at the
work branch tip), the same seam the build/recovery callers use — do
NOT improvise a one-off `git worktree add` or a fresh clone. The
answered-merge branch shape this dispatcher handles is a branch whose
tip ALREADY carries the prior build's done-move commit (NOT the
arbitrary `work-<slug>.txt` content the surfacer's unit test seeds);
drive `performIntegration` with `committedRecovery: true` +
`freshWorktreeGate: true` so it takes the (now gate-honouring) recovery
tail rather than the build path (which would raise
`IntegrationNothingStaged` on the already-committed done-move).

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

OQ6 (spec, still open): when `main` moved between the human's answer
and the apply step but the rebased tip STILL verifies GREEN, does apply

  (a) HONOUR the prior approval and land — cheap; trusts that a green
      re-verify is sufficient (the spec calls this the likely default);
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
- [ ] The unmerged `work/<slug>` is checked out via the existing
      `workspace.ts` per-job worktree seam (`createJob` off the hub
      mirror), NOT a bespoke worktree/clone; `performIntegration` is
      invoked with `committedRecovery: true` + `freshWorktreeGate: true`.
- [ ] Stale approval policy: HONOUR + land on a green re-verify
      (default); consult the resolved `strictMergeApproval` boolean from
      `strict-merge-approval-gate` for the opt-in re-surface-on-changed-
      merge-base. (The flag/resolver itself is that sibling task; this
      task only CONSUMES the resolved value and, until it lands,
      hard-codes the OFF default.)
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
> Decision in the spec, the observation
> `merge-question-tasks-premised-on-retired-disposition-vocabulary-2026-06-25.md`,
> the keystone done record `agentic-apply-retire-disposition-vocabulary.md`,
> and the current apply rung (`apply-persist.ts` / `apply-decide.ts` /
> `decision-engine.ts`). Add the answered-merge LAND as a runner-ACTION
> dispatch (sibling to the agentic content decision; keyed off the
> merge-question identity + the human's answer), NOT a `DecisionOutcome`
> and NOT a revived disposition field. Check out the unmerged work
> branch via the existing `workspace.ts` per-job worktree seam
> (`createJob`), then invoke the LAND primitive via the existing
> `integration-core.ts` `performIntegration` with `committedRecovery:
> true` + `freshWorktreeGate: true` — do NOT re-implement
> rebase/verify/advance and do NOT improvise a worktree/clone. (The
> committed-recovery tail's fresh-gate honouring is the preceding task
> `committed-recovery-honours-fresh-worktree-gate`; the
> `strictMergeApproval` flag is `strict-merge-approval-gate`. Both are
> `blockedBy` — build after them.) Tests must hit external behaviour
> (what lands on `main`, what routes to needs-attention) and prove
> `verify` ran on the rebased tip. Run the AGENTS.md acceptance gate.

## Applied answers 2026-06-26

### q1: What is your answer to SPEC OPEN QUESTION 6 (the stale-approval policy)? When `main` moves between the human's answer and the apply step but the rebased tip STILL verifies GREEN, does apply (a) HONOUR the prior approval and land (cheap; trusts that a green re-verify is sufficient), or (b) RE-SURFACE the question because the merge-base CHANGED (the host-agnostic analogue of GitHub's 'dismiss stale approvals when the base changes')? And the sub-question: if both ship (a + b opt-in), what flag/config axis controls (b), and what is its default?

(a) HONOUR the prior approval and land when the rebased tip re-verifies GREEN, with (b) re-surface-on-changed-merge-base as an OPT-IN strictness layered on top. The opt-in (b) is controlled by a per-repo `strictMergeApproval` setting (resolved via the gate-family precedence chain: flag > env > per-repo > global > default), defaulting OFF, so the cheap green-re-verify-is-enough path is the default. On the binary sidecar, (b) clears the answer back to no-answer and re-surfaces the merge-question (authored on `main`/runner under the `advancing` lock, so no branch-side mutation). This matches SPEC sidecar Q4. Story #16's RED-re-verify refusal is unchanged.

### q2: This task's premise appears STALE: it specifies mirroring the apply rung's `promote-slice`/`dropped` disposition-dispatch and dispatching an answered `merge` DISPOSITION, but that whole disposition vocabulary has since been RETIRED. Should this task be re-scoped (and re-reviewed) against the new AGENTIC apply model before it is built, or has its premise already been reconciled somewhere I have not seen?

Yes — the premise was stale (the disposition vocabulary is retired), and it has now been RECONCILED in this pass (see SPEC sidecar Q1/Q2). The task body has been amended in place to the new model: do NOT mirror a `promote-slice`/`dropped` disposition-dispatch (gone) and do NOT route through the agentic `decide()`. Build the answered-merge land as a DETERMINISTIC runner-ACTION dispatch (see Q3). The task stays `needsAnswers: true` only until Q1 (policy) + Q3 (mechanism) here are applied.

### q3: Given the disposition vocabulary is retired and the agentic apply outcome set is `{task | spec | adr | delete | ask}` (a content-mint / delete / follow-up model), HOW should an answered merge-question dispatch the LAND primitive (rebase -> re-verify -> advance) within that model? It is a runner ACTION, not a content outcome, so it does not map onto any current `DecisionOutcome`. Does `merge` become a new agentic outcome wired only into the merge-question caller, a separate non-agentic state-action dispatch keyed off the merge-question's answer, or something else?

A SEPARATE, DETERMINISTIC answer-driven runner-ACTION dispatch layer — NOT a new `DecisionOutcome` and NOT a route through the agentic `decide()`. This is the keystone decision (SPEC sidecar Q1): a merge-acceptance has no judgement content (the human's plain merge|hold|drop answer IS the decision; the correctness gate is the apply-time re-verify on the rebased tip, never an agent), so routing it through an LLM only adds cost and non-determinism.

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
The `kind` is read from the sidecar's typed identity field (SPEC sidecar Q5-ii), introduced by the foundational task `sidecar-kind-field` (a `blockedBy` of this task). Read the typed `kind` field directly — do NOT string-sniff the `default` menu (the workaround that got `merge-question-surfacer`'s first build blocked at review). The merge-question sidecar carries a deterministic CHOICE shape (merge|hold|drop) the human picks and the system parses unambiguously, distinct from the free-text content-question shape. The sibling stuck-lock requeue action SHARES this same runner-action layer (resolve once). Invoke the land via the EXISTING `integration-core.ts` `performIntegration` — do not re-implement rebase/verify/advance. Record the split as an ADR (working name `answered-question-dispatch-splits-runner-action-vs-agentic-content`).

### q4: The build agent STOPPED here (2026-06-26): the applied answers pin the dispatch layer but not (1) the committed-recovery tail re-verifying on the rebased tip, (2) the worktree/checkout seam, (3) the strictMergeApproval config axis. Resolve the scope.

CONFIRMED and RE-SCOPED (the stop was correct, not over-cautious). The
three gaps are resolved without reopening any policy:

1. COMPOSITION (carved out). `performIntegration` does NOT re-verify on
   the rebased tip for the answered-merge state: the build path commits
   the done-move BEFORE the rebase (so it raises `IntegrationNothingStaged`
   on a branch that already carries that commit), and the
   `committedRecovery` tail DELIBERATELY skips `runFreshWorktreeGate`.
   Neither satisfies "prove verify ran on the rebased tip". Fixed by the
   new PRECEDING task `committed-recovery-honours-fresh-worktree-gate`
   (thread `freshWorktreeGate` into `recoverAlreadyCommitted`; gate the
   rebased tip before integrate; RED refuses). This task then drives
   `performIntegration` with `committedRecovery: true` +
   `freshWorktreeGate: true`. Added to `blockedBy`.

2. WORKTREE SEAM (named in-band). The apply rung runs on `main`; check
   out the unmerged `work/<slug>` via the EXISTING `workspace.ts`
   per-job worktree seam (`createJob` -> `git worktree add` off the hub
   mirror), the same seam build/recovery use. No bespoke worktree/clone.
   The dispatcher handles the done-move-committed branch shape (NOT the
   surfacer unit test's arbitrary `work-<slug>.txt` seed). Folded into
   "What to build" + the prompt above.

3. CONFIG AXIS (carved out). `strictMergeApproval` (OQ6's opt-in) is a
   new user-visible gate-family member; carved into the new sibling task
   `strict-merge-approval-gate` (mirrors how `merge-questions-gate-axis`
   carved out `mergeQuestions`). This task CONSUMES the resolved boolean
   and, until that sibling lands, hard-codes the OFF default (honour +
   land on a green re-verify; no re-surface on changed merge-base).
   Added to `blockedBy`.

Net: this task is now the DISPATCH LAYER + the WORKTREE SEAM + the
verify-on-rebased-tip REFUSAL, all small and decidable. Build it AFTER
`committed-recovery-honours-fresh-worktree-gate` and
`strict-merge-approval-gate`.
