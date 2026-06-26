<!-- dorfl-sidecar: item=prd:land-time-reverify-and-parallel-merge-ceiling type=prd slug=land-time-reverify-and-parallel-merge-ceiling allAnswered=false -->

## Q1

**Re-decomposing the three merge-question slices against the BINARY sidecar + agentic `decide(input, allowedOutcomes) -> {mint-task | mint-prd | delete-source | ask-follow-up}` model: is 'land this merge' added as a NEW `DecisionOutcome` (e.g. `land-merge`) on the agentic dispatch, or is it expressed via the EXISTING outcome set (e.g. mint a follow-up task that the next advance pass picks up), or is it a DISTINCT answer-driven-action dispatch layer keyed off the surfaced question's identity + the human's plain answer (the sketch the observation note proposes)? This is the keystone — every restatement of merge-question-surfacer / apply-rung-merge-disposition / merge-questions-gate-axis flows from it.**

> The PRD was moved back to `prds/proposed/` 2026-06-25 with `needsAnswers: true` because the merged keystone PRD `agentic-question-resolution-retire-disposition-vocabulary` retired the `disposition=` field and the `merge|hold|drop` / `promote-*` / `dropped` token set entirely. The three drifted slices (`merge-question-surfacer`, `apply-rung-merge-disposition`, `merge-questions-gate-axis`) were all premised on emitting/dispatching that vocabulary. The companion observation `work/notes/observations/merge-question-tasks-premised-on-retired-disposition-vocabulary-2026-06-25.md` sketches a third option (a distinct answer-driven-action dispatch layer rather than forcing `merge` into `decide()`'s content-outcome union). The PRD body's 'Needs re-tasking' block names this as decision #1 blocking re-task.

_Suggested default: Distinct answer-driven-action dispatch layer (the observation's sketch): keep `decide()` focused on content-outcomes (mint/delete/follow-up), and route runner ACTIONS (land-merge, and the sibling stuck-lock requeue) through a separate dispatch keyed off question identity + plain answer — preserves the keystone's simplification and matches the 'four kinds of questions through one sidecar' generalisation flagged in the PRD's see-also._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

The DISTINCT answer-driven runner-ACTION dispatch layer (the observation's sketch) — and crucially NOT routed through the agentic `decide()` at all. This is the keystone, and the reason is sharper than "keep `decide()` focused": a merge-acceptance has NO judgement content left to decide. The human's plain answer (merge | hold | drop) IS the decision, and the actual correctness gate is `performIntegration`'s re-verify on the rebased tip — not an agent. Putting an LLM in front of an already-made, already-re-validated decision can only add cost, latency, and non-determinism (a malformed verdict, a hallucinated `ask`); it cannot add value. So:

- An answered sidecar of a runner-ACTION kind (`merge`, and later `stuck-lock requeue`) is dispatched DETERMINISTICALLY by the apply rung, keyed off (question-KIND, the human's plain answer) → invoke the land/requeue action. NO agent run.
- An answered sidecar of a CONTENT kind (observation/triage, spec) keeps today's agentic path: `decide(input, allowedOutcomes) → {task|prd|adr|delete|ask}`.

Apply gains a kind-check BEFORE the agentic decider:
```
apply(answered sidecar):
  if sidecar.kind is a runner-action kind (merge | stuck-requeue):
      dispatch the action deterministically from (kind, plain answer)   # no agent
  else:                                   # observation / content
      verdict = decide(input, allowedOutcomes); route verdict           # agent, as today
```
This RESTORES the pre-disposition determinism for the action class (where determinism is correct) while keeping agentic flexibility for the content class — a cleaner split than the old uniform-disposition model, because it makes explicit WHICH questions are mechanical vs judgement. `merge` is therefore NOT a new `DecisionOutcome` (that would route it through the agent we are trying to avoid). This is ADR-worthy; record it (working name: `answered-question-dispatch-splits-runner-action-vs-agentic-content`).

The runner-action sidecar may also carry a slightly DIFFERENT SHAPE from a content question: a deterministic CHOICE menu (merge | hold | drop) the human picks and the system parses unambiguously, rather than the free-text answer box a content question uses. The KIND tag that selects the dispatch rides the existing `<type>-`/kind axis (see Q5) — today the flat `work/questions/` folder + the typed kind field; later, per the questions-folder plan, kind-based subfolders (`questions/merge/`, `questions/stuck/`, ...) make this cleaner still. The load-bearing invariant from `questions-folder-rename-and-kind-axis-prefix-vs-subfolder` MUST hold: sidecar authorship stays on `main`/runner (under the `advancing` lock); a work branch never authors a sidecar.

## Q2

**Should the three drifted slices (`merge-question-surfacer`, `apply-rung-merge-disposition`, `merge-questions-gate-axis`) be DROPPED-and-rewritten from scratch against the chosen model, or AMENDED in place? They carry `prd:` / `covers: [14,15,16,17]` linkage back to this PRD and existing review-nit sidecars (Q1, Q2, Q3, Q5 of `observation-review-nits-…`) reference them by name.**

> PRD 'Needs re-tasking' block, decision #2. Amend-in-place preserves the `covers:` linkage and the open review-nit sidecar references; drop-and-rewrite is cleaner against a structurally different dispatch model. The sidecar `observation-review-nits-land-time-reverify-and-parallel-merge-ceiling-2026-06-22.md` currently has 5 open Qs naming these slices, so a drop loses that thread unless carried over.

_Suggested default: Drop-and-rewrite: the change is large enough (a new outcome / new dispatch layer, restated gate axis, restated stale-approval policy) that an amend reads as a mechanical token-swap and hides the model shift; carry forward the surviving FIXED parts (gate is separate from observationTriage, defaults higher than `off`, same precedence chain; apply re-verifies + refuses on red; PR-optional by construction) verbatim into the new slice bodies, and close the open review-nit Qs as resolved-by-respin._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

AMEND in place (override the suggested drop-and-rewrite). The three task bodies have already been reframed against the binary-sidecar + runner-action-dispatch model in this same pass (they carry their own Open questions referencing the retired vocabulary and the new dispatch layer), so the model shift is NOT hidden behind a mechanical token-swap — it is stated explicitly in each body. Amending preserves the `prd:`/`covers: [14,15,16,17]` linkage and the open review-nit sidecar references without a re-mint. Carry the surviving FIXED parts verbatim (gate separate from `observationTriage`, default not `off`, same precedence chain; apply re-verifies + refuses on red; PR-optional by construction). The three tasks stay `needsAnswers: true` until the remaining sub-decisions (Q3/Q4 here) are answered.

## Q3

**Restating original OQ 7 against the binary sidecar: what is the merge-question gate's NAME (e.g. `mergeQuestions` / `surfaceMerge` / `landQuestions`), DEFAULT (`ask` surfaces and waits, `auto` self-answers + lands an unblocked merge, `off` never surfaces), and SHAPE (3-state `off|ask|auto` mirroring `observationTriage`, or a boolean now that `auto` no longer maps to an 'answered-merge disposition')? The PRD fixes that it must be SEPARATE from `observationTriage` and default HIGHER than `off`; everything else is open and the keystone retirement changes what `auto` even means.**

> PRD body OQ 7, Implementation Decisions 'Merge-questions get a SEPARATE, higher-default gate from observationTriage (fixed; tuning in OPEN QUESTION 7)', and User Story #17. Original wording assumed `auto` = 'auto-land an answered/unblocked merge' via the retired answered-merge disposition; in the binary model `auto` would mean the runner self-supplies the 'land' answer without surfacing, which is materially the merge-mode fast-path — that needs explicit confirmation, not a rename.

_Suggested default: Name `mergeQuestions`; shape 3-state `off|ask|auto` (mirrors `observationTriage`'s shape for one consistent gate vocabulary); default `ask` (surface and wait for human approval — matches propose semantics and avoids silently dropping pushed work); `auto` available for a trusted repo as the merge-mode-like fast path (runner self-answers + lands through the same apply-time re-verify); precedence chain same as the family (flag > env > per-repo > global > default)._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Accept the suggested default with the `auto` semantics restated for the deterministic-action model:
- NAME: `mergeQuestions`.
- SHAPE: 3-state `off | ask | auto`, mirroring `observationTriage`.
- DEFAULT: `ask` (surface + wait for the human's plain merge|hold|drop answer; matches propose semantics; never silently drops pushed work).
- PRECEDENCE: the gate family chain (flag > env > per-repo > global > default).
- `auto` (restated, no retired token): the runner self-supplies the `merge` answer WITHOUT surfacing, and lands through the SAME deterministic action dispatch + apply-time re-verify (the merge-mode-like fast path). It does NOT invoke the agentic decider either — consistent with Q1: a merge-land is never an agent decision. `off` only for a repo that lands by some other means.

## Q4

**Restating original OQ 6 against the binary sidecar: when `main` moved between the human's answer to a merge-question and apply, and the rebased tip STILL verifies GREEN, does apply (a) honour the prior answered question and land (cheap; a green re-verify is sufficient proof), or (b) re-surface the merge-question because the merge-base changed (conservative; host-agnostic analogue of GitHub's 'dismiss stale approvals when the base changes')? Choice of (b) means in the binary model the engine ERASES the prior answer (`no-answer` again) and re-asks — confirm that erase-on-base-change is acceptable given the keystone's append-only sidecar discipline.**

> PRD body OQ 6 and User Story #16 sub-decision. Story #16 already fixes that apply refuses on a RED re-verify; this is purely the green-but-base-moved case. The keystone made sidecar entries binary and apply agentic, so 'dismiss stale approval' is now 'clear the `answer` and bump back to no-answer', not 'flip a disposition token' — that interaction needs naming.

_Suggested default: (a) honour the prior answer and land when the rebased tip is green, with (b) available as an opt-in `strictMergeApproval` per-repo setting; rationale: a green re-verify on the rebased tip IS the proof of correctness in the lived context (the brief's whole thesis), so requiring a re-answer on every benign base move would drown a busy repo in re-prompts for zero correctness gain. The conservative branch stays available for repos that want approval-pinned-to-merge-base semantics._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

(a) HONOUR the prior answer and land when the rebased tip re-verifies GREEN, with (b) re-surface-on-changed-merge-base as an OPT-IN strictness (`strictMergeApproval`, per-repo, default OFF). Rationale: a green re-verify on the rebased tip IS the proof of correctness in the lived context — the brief's whole thesis — so requiring a re-answer on every benign base move would drown a busy repo in re-prompts for zero correctness gain. On the binary sidecar, (b) means the engine CLEARS the answer back to no-answer and re-asks (the merge-question is re-surfaced fresh); since sidecar authorship is on `main`/runner under the `advancing` lock, that erase-and-re-surface is a normal runner-side write, not a branch-side mutation, so it is consistent with the append-only-on-the-branch discipline. Story #16's RED-re-verify refusal is unchanged and independent of this.

## Q5

**The two cross-cutting see-also questions the PRD flags as SHARED with the stuck-lock-questions sibling and explicitly says must be answered ONCE for the whole pattern: (i) can a sidecar key to a LOCK-REF / BRANCH identity, not only to a `work/<slug>.md` file path (an unmerged `work/*` branch's merge-question may have no item-body file to anchor on)? (ii) the questions-folder shape/name — is the existing `<type>-` filename prefix sufficient to encode 'merge' / 'stuck' / 'triage' / 'spec' kinds, or do they want subfolders / a typed field, and is `questions/` still the right folder name now that four kinds flow through it?**

> PRD body 'Part of a larger generalization (see-also; NOT in this brief's scope)'. Question (i) is unavoidable for this brief's surfacer — a merge-question for an unmerged branch with no item-body needs an identity to key on, and the current sidecar shape is `work/questions/<type>-<slug>.md`. Question (ii) is captured in `work/notes/observations/questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21.md`. The PRD insists both be resolved consistently with the stuck-lock sibling, not twice with drift.

_Suggested default: (i) extend the sidecar identity to permit a `branch:` / `ref:` key in addition to `item:` (the branch ref is the stable identity for an unmerged-branch merge-question); the parser already namespaces identity via the top-of-file HTML comment so this is an additive field, not a schema break. (ii) keep the `<type>-` prefix encoding (it already round-trips through the parser and Q1-Q5 of the open review-nit sidecar use it) and keep `questions/` as the folder name; revisit folder rename only if a fifth kind lands._

<!-- q5 fields: id=q5 -->

**Your answer** (write below this line):

(i) YES — extend the sidecar identity to permit a `branch:` / `ref:` key in addition to `item:` (an unmerged-branch merge-question has no item-body file to anchor on; the branch ref is its stable identity). Additive to the top-of-file identity HTML comment, not a schema break. CONSTRAINT (load-bearing, from `questions-folder-rename-and-kind-axis-prefix-vs-subfolder` round-2 Q3): even when keyed to a branch/ref, the sidecar must still be AUTHORED on `main`/runner under the `advancing` lock — NEVER authored against the work branch — or the 3-way-merge guarantee that stale sidecar CONTENT cannot survive a rebase is broken.

(ii) For NOW: keep the flat `work/questions/` folder and the `<type>-`/kind encoding, and add an explicit typed `kind` field (merge | stuck | triage | spec) to the identity comment — this is what the apply rung reads to choose the deterministic-action vs agentic-content dispatch (Q1). LATER (the intended direction, per the questions-folder note + idea `folder-taxonomy-and-prd-edit-handshake`): group sidecars into kind-based SUBFOLDERS (`questions/merge/`, `questions/stuck/`, `questions/triage/`, `questions/spec/`), which is safe because kinds are temporally mutually-exclusive per item and the subfolder is a pure function of (kind, identity). That folder restructure + any `questions/` rename is its own ADR-worthy decision, tracked by `task:questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21`; do NOT fold the restructure into this PRD — this PRD only needs the typed `kind` field to exist so the runner-action dispatch can key on it.
