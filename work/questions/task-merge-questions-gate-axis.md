<!-- dorfl-sidecar: item=task:merge-questions-gate-axis type=task slug=merge-questions-gate-axis allAnswered=false -->

## Q1

**OQ7(a) — Gate name: what is the exact name for the new merge-question gate axis? Candidates named in the PRD/task: `mergeQuestions`, `surfaceMerge`, or another camelCase name consistent with the existing gate-family vocabulary.**

> Pre-existing open question carried by the task (frontmatter `needsAnswers: true`; body `## Open questions (needsAnswers — prd OQ7)` item 1) and by the PRD `land-time-reverify-and-parallel-merge-ceiling` OPEN QUESTION 7(a). The SEPARATION from `observationTriage` and the higher-than-`off` default are FIXED; only this name is open. The existing gate family it must sit beside is `autoBuild`/`autoTask`/`observationTriage`, resolved CLI flag > env > per-repo config > global config > built-in default (verified at `work/protocol/WORK-CONTRACT.md:202`). The name must be camelCase and not silently re-mean an existing gate.

_Suggested default: `mergeQuestions` — it names the surfaced thing (merge-questions) the way `observationTriage` names its domain, reads consistently in the `flag > env > per-repo > global > default` chain, and avoids the verb-flavoured `surfaceMerge` which could be read as an action rather than a policy axis._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**OQ7(b) — Default value: what is the built-in default for the merge-question gate? `ask` (surface + wait for a human answer), `auto` (auto-land an answered/unblocked merge — the merge-mode-like fast path), or `off` (only for a repo that lands by some other means)? The fixed constraint is: it must NOT default to `off`.**

> Pre-existing open question (task body item 2; PRD OQ7(b)). Rationale fixed in the PRD's Implementation Decisions: a dropped merge-question means finished, pushed work never lands, so the default must be HIGHER than `observationTriage`'s `off`. CAUTION (drift): the `auto` sub-state is defined in the PRD as `auto-land an answered/unblocked merge`, which presupposes the answered-merge `merge|hold|drop` disposition mechanism — that mechanism has since been retired (see the separate drift question and `work/questions/observation-merge-question-tasks-premised-on-retired-disposition-vocabulary-2026-06-25.md`). So the precise meaning of `auto` may need restating against the binary-sidecar / agentic-apply model before it can be the default.

_Suggested default: `ask` — the PRD names it as the likely default (surface + wait for a human answer), it is the conservative choice that honours "propose surfaces and waits for the human approval", and it does not depend on the (now-reshaped) auto-land disposition mechanism the way `auto` does._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**OQ7(c) — Shape: is the gate a three-state `off | ask | auto` mirroring `observationTriage`'s shape, or a boolean? The PRD leans 3-state; confirm or override.**

> Pre-existing open question (task body item 3; PRD OQ7(c)). A 3-state axis composes with the existing gate-family vocabulary and lets a repo distinguish "surface and wait" (`ask`) from "auto-land" (`auto`); a boolean cannot express that middle. Note the coherence dependency on OQ7(b): if `auto` is dropped or restated under the binary-sidecar model, the third state may lose its meaning, which would tip the answer toward boolean.

_Suggested default: Three-state `off | ask | auto`, mirroring `observationTriage` — keeps the gate vocabulary uniform across the family and preserves the surface-vs-auto-land distinction the PRD relies on, provided OQ7(b)'s `auto` semantics are restated coherently against the current model._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Should this task be HELD (kept out of the build pool) and/or re-scoped until the sibling `merge-question-surfacer` is re-decomposed against the retired-disposition model — and does answering OQ7 require restating `auto` without the `merge|hold|drop` token mechanism?**

> Lens 1 (claim-vs-reality) / lens 4 (coherence). This task's job is to gate WHETHER `merge-question-surfacer` is invoked, and its acceptance criterion `merge-question-surfacer is invoked iff this gate's resolved value says so` depends on that surfacer's shape. But the surfacer's mechanism has drifted: the PRD `agentic-question-resolution-retire-disposition-vocabulary` (with done tasks `triage-observations-skill-retire-disposition-vocabulary`, `agentic-apply-retire-disposition-vocabulary`) RETIRED the sidecar `disposition=` field — entries are now BINARY (no-answer | answered), confirmed in `work/protocol/SURFACE-PROTOCOL.md` ("There is NO `disposition` field... a sidecar entry is BINARY"). Yet `work/tasks/backlog/merge-question-surfacer.md` still specifies emitting `merge | hold | drop` dispositions, and this task's OQ7(b) `auto` state is defined as `auto-land an answered/unblocked merge` on that retired mechanism. The observation `work/questions/observation-merge-question-tasks-premised-on-retired-disposition-vocabulary-2026-06-25.md` already flags all three sibling tasks (`merge-question-surfacer`, `apply-rung-merge-disposition`, `merge-questions-gate-axis`) as premised on the retired vocabulary and proposes holding them and re-decomposing the PRD. This task is the least directly drifted of the three (it only gates invocation), but the `auto` semantics it asks the human to pick are entangled with the retired mechanism, so it should not be promoted/built independently of that re-decompose. The task body's existing cross-cutting note (sidecar-keying to a lock-ref/branch identity; questions-folder shape) is also still unresolved and shared with the stuck-lock sibling.

_Suggested default: Hold this task out of the build pool and resolve it as part of the `land-time-reverify-and-parallel-merge-ceiling` re-decompose against the binary-sidecar / agentic-apply model (resolving the observation above in the same pass): keep the FIXED parts (separate axis, default not `off`, same precedence chain), but restate OQ7(b)'s `auto` as "auto-land an ANSWERED, unblocked merge" in terms of the binary answered-state (no `merge` token), and keep the gate's name/shape (OQ7 a/c) decided here since they do not depend on the retired vocabulary._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):
