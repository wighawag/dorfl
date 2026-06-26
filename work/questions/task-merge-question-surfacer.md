<!-- dorfl-sidecar: item=task:merge-question-surfacer type=task slug=merge-question-surfacer allAnswered=false -->

## Q1

**Does a merge-question emit a PLAIN binary sidecar entry (the surfacer's job is only to enumerate + surface), with the merge/hold/drop CHOICE carried as the human's free-text answer that the (separate) apply-action layer interprets? Confirm the surfacer emits NO disposition token (there is none to emit).**

> Pre-existing open question carried by the task (frontmatter `needsAnswers: true`; body `## Open questions (needsAnswers — disposition vocabulary was retired)` item 1). The PRD `agentic-question-resolution-retire-disposition-vocabulary` RETIRED the sidecar `disposition=` field — entries are now BINARY (no-answer | answered), confirmed in `work/protocol/SURFACE-PROTOCOL.md` ("There is NO `disposition` field... a sidecar entry is BINARY"). The decision-engine `decide(input, allowedOutcomes) -> {task | prd | adr | delete | ask}` has no `merge` content outcome. The observation `work/notes/observations/merge-question-tasks-premised-on-retired-disposition-vocabulary-2026-06-25.md` sketches the re-decompose: answer-driven runner ACTIONS (merge/land, sibling stuck-lock requeue) are a DISTINCT dispatch layer keyed off the surfaced question's IDENTITY + the human's plain answer, not a `decide()` content outcome.

_Suggested default: Yes — the surfacer emits a plain BINARY sidecar entry (no disposition token, none exists); the merge/hold/drop choice is the human's free-text answer, interpreted by the separate `apply-rung-merge-disposition` action layer. This matches the keystone retire-disposition model and the observation's sketched re-decompose, and lets this surfacer be a clean INSTANCE of the surface→answer→apply shape rather than a bespoke emitter._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Can a sidecar key to a LOCK-REF / BRANCH identity, not only a `work/<type>-<slug>.md` path? An unmerged `work/*` branch may have no item body in the working tree (the branch tip carries the item, `main` does not), so the existing `work/questions/<type>-<slug>.md` convention may not be addressable from `main`.**

> Pre-existing open question carried by the task body, item 2(i) — explicitly flagged as one of the two cross-cutting questions SHARED with the stuck-lock surfacer sibling that must be answered ONCE across both (see the PRD `land-time-reverify-and-parallel-merge-ceiling` "Part of a larger generalization" section). The current sidecar identity is path-keyed via the `<type>-<slug>.md` naming and the `item=<type>:<slug>` HTML comment (per `SURFACE-PROTOCOL.md` "The hand-written sidecar shape"). A merge-question enumerated by `git` reachability against `main` (the floor) has a branch ref but not necessarily a `work/<slug>.md` on `main` — so the keying scheme has to cover branch/lock-ref identity too.

_Suggested default: Extend the sidecar identity to a tagged union (`{kind: 'item', type, slug}` | `{kind: 'branch', ref}` | `{kind: 'lock', ref}`) reflected in both the filename and the `item=` HTML comment, so a branch-keyed sidecar is parseable without an item body on `main`. Resolve jointly with the stuck-lock surfacer so a single keying scheme covers both._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**What is the shape/name of the questions folder under the new identity scheme — does it stay `work/questions/<type>-<slug>.md`, or does it gain a branch/lock-ref-keyed sibling shape (e.g. `work/questions/branch--<sanitised-ref>.md`)?**

> Pre-existing open question carried by the task body, item 2(ii) — the second cross-cutting question SHARED with the stuck-lock surfacer sibling (PRD "Part of a larger generalization"). Coheres with the prior question: once a sidecar can key to a branch/lock-ref, the on-disk filename needs a deterministic, collision-free encoding distinct from `<type>-<slug>.md`. The advance engine's CAS-atomic append (per `SURFACE-PROTOCOL.md`) reads the path, so the shape is load-bearing.

_Suggested default: Keep `work/questions/<type>-<slug>.md` for item-keyed sidecars unchanged, and add a sibling shape `work/questions/branch-<sanitised-ref>.md` (and `lock-<sanitised-ref>.md` for the stuck-lock sibling) where `<sanitised-ref>` is the slash-flattened branch name. Decide jointly with the stuck-lock surfacer._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Should this task be HELD out of the build pool until the parent PRD `land-time-reverify-and-parallel-merge-ceiling` is re-decomposed against the binary-sidecar / agentic-apply model, with this task's body language reconciled in the same pass?**

> REVIEW lens 1 (claim-vs-reality) / lens 4 (coherence). The task body itself still says, in `## What to build` and in an acceptance criterion, that each merge-question is emitted "with a disposition choice of `merge | hold | drop`" — even while its own `## Open questions` block acknowledges the disposition vocabulary was retired and the surfacer must emit no token. The observation `work/notes/observations/merge-question-tasks-premised-on-retired-disposition-vocabulary-2026-06-25.md` (`needsAnswers: true`) names all three sibling tasks (`merge-question-surfacer`, `apply-rung-merge-disposition`, `merge-questions-gate-axis`) as premised on the retired vocabulary and its "Suggested next step" is: "Re-task `land-time-reverify-and-parallel-merge-ceiling` ... BEFORE any of its merge-question tasks are built. Until then these tasks should not be promoted to the build pool." The sibling sidecar `work/questions/task-merge-questions-gate-axis.md` Q4 reached the same hold conclusion.

_Suggested default: Hold this task out of the build pool and resolve it as part of the `land-time-reverify-and-parallel-merge-ceiling` re-decompose against the binary-sidecar / agentic-apply model (discharging the observation in the same pass). In that pass, rewrite `## What to build` and the acceptance criterion to drop the `merge | hold | drop` disposition-token language (already contradicted by the task's own Open questions), so the body matches the answer to Q1._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):
