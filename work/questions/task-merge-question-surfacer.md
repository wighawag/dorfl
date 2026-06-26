<!-- dorfl-sidecar: item=task:merge-question-surfacer type=task slug=merge-question-surfacer allAnswered=false -->

## Q1

**Does a merge-question emit a PLAIN binary sidecar entry (the surfacer's job is only to enumerate + surface), with the merge/hold/drop CHOICE carried as the human's free-text answer that the (separate) apply-action layer interprets? Confirm the surfacer emits NO disposition token (there is none to emit).**

> Pre-existing open question carried by the task (frontmatter `needsAnswers: true`; body `## Open questions (needsAnswers — disposition vocabulary was retired)` item 1). The PRD `agentic-question-resolution-retire-disposition-vocabulary` RETIRED the sidecar `disposition=` field — entries are now BINARY (no-answer | answered), confirmed in `work/protocol/SURFACE-PROTOCOL.md` ("There is NO `disposition` field... a sidecar entry is BINARY"). The decision-engine `decide(input, allowedOutcomes) -> {task | prd | adr | delete | ask}` has no `merge` content outcome. The observation `work/notes/observations/merge-question-tasks-premised-on-retired-disposition-vocabulary-2026-06-25.md` sketches the re-decompose: answer-driven runner ACTIONS (merge/land, sibling stuck-lock requeue) are a DISTINCT dispatch layer keyed off the surfaced question's IDENTITY + the human's plain answer, not a `decide()` content outcome.

_Suggested default: Yes — the surfacer emits a plain BINARY sidecar entry (no disposition token, none exists); the merge/hold/drop choice is the human's free-text answer, interpreted by the separate `apply-rung-merge-disposition` action layer. This matches the keystone retire-disposition model and the observation's sketched re-decompose, and lets this surfacer be a clean INSTANCE of the surface→answer→apply shape rather than a bespoke emitter._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Yes, with one refinement to the suggested default. The surfacer emits a BINARY sidecar entry with NO disposition token (none exists). BUT the merge/hold/drop choice is NOT free-text — it is a DETERMINISTIC CHOICE shape (a fixed menu the human picks and the system parses unambiguously), distinct from the free-text answer box a content question uses. This is what lets the separate apply-action layer dispatch the land DETERMINISTICALLY without an agent run (PRD sidecar Q1 / `apply-rung-merge-disposition` Q3): a merge-acceptance has no judgement content, so the answer must be machine-parseable, not interpreted by an LLM. The surfacer's job is enumerate + surface (binary, plain, kind-tagged `merge`); the apply-action layer reads the kind + the chosen option and acts. So: binary entry, no token, deterministic-choice answer shape, kind=merge.

## Q2

**Can a sidecar key to a LOCK-REF / BRANCH identity, not only a `work/<type>-<slug>.md` path? An unmerged `work/*` branch may have no item body in the working tree (the branch tip carries the item, `main` does not), so the existing `work/questions/<type>-<slug>.md` convention may not be addressable from `main`.**

> Pre-existing open question carried by the task body, item 2(i) — explicitly flagged as one of the two cross-cutting questions SHARED with the stuck-lock surfacer sibling that must be answered ONCE across both (see the PRD `land-time-reverify-and-parallel-merge-ceiling` "Part of a larger generalization" section). The current sidecar identity is path-keyed via the `<type>-<slug>.md` naming and the `item=<type>:<slug>` HTML comment (per `SURFACE-PROTOCOL.md` "The hand-written sidecar shape"). A merge-question enumerated by `git` reachability against `main` (the floor) has a branch ref but not necessarily a `work/<slug>.md` on `main` — so the keying scheme has to cover branch/lock-ref identity too.

_Suggested default: Extend the sidecar identity to a tagged union (`{kind: 'item', type, slug}` | `{kind: 'branch', ref}` | `{kind: 'lock', ref}`) reflected in both the filename and the `item=` HTML comment, so a branch-keyed sidecar is parseable without an item body on `main`. Resolve jointly with the stuck-lock surfacer so a single keying scheme covers both._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Yes — extend the sidecar identity to a tagged union that permits a `branch:` / `ref:` (and `lock:` for the stuck-lock sibling) key in addition to `item:`, reflected in both the `item=` HTML comment and the filename. An unmerged-branch merge-question has no item body on `main`, so the branch ref is its stable identity. Resolve ONCE jointly with the stuck-lock surfacer (this is PRD sidecar Q5-i). LOAD-BEARING CONSTRAINT (from `questions-folder-rename-and-kind-axis-prefix-vs-subfolder` round-2 Q3): even a branch/ref-keyed sidecar must still be AUTHORED on `main`/runner under the `advancing` lock, NEVER against the work branch, or the 3-way-merge guarantee (stale sidecar content cannot survive a rebase) breaks.

## Q3

**What is the shape/name of the questions folder under the new identity scheme — does it stay `work/questions/<type>-<slug>.md`, or does it gain a branch/lock-ref-keyed sibling shape (e.g. `work/questions/branch--<sanitised-ref>.md`)?**

> Pre-existing open question carried by the task body, item 2(ii) — the second cross-cutting question SHARED with the stuck-lock surfacer sibling (PRD "Part of a larger generalization"). Coheres with the prior question: once a sidecar can key to a branch/lock-ref, the on-disk filename needs a deterministic, collision-free encoding distinct from `<type>-<slug>.md`. The advance engine's CAS-atomic append (per `SURFACE-PROTOCOL.md`) reads the path, so the shape is load-bearing.

_Suggested default: Keep `work/questions/<type>-<slug>.md` for item-keyed sidecars unchanged, and add a sibling shape `work/questions/branch-<sanitised-ref>.md` (and `lock-<sanitised-ref>.md` for the stuck-lock sibling) where `<sanitised-ref>` is the slash-flattened branch name. Decide jointly with the stuck-lock surfacer._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

For NOW: keep the flat `work/questions/` folder; item-keyed sidecars stay `work/questions/<type>-<slug>.md`, and add a sibling shape for branch/lock keys (e.g. `work/questions/branch-<sanitised-ref>.md`, `lock-<sanitised-ref>.md`) plus an explicit typed `kind` field (merge | stuck | triage | spec) in the identity comment — the kind is what the apply rung reads to choose deterministic-action vs agentic-content dispatch. LATER (intended direction, per `questions-folder-rename-and-kind-axis-prefix-vs-subfolder` + idea `folder-taxonomy-and-prd-edit-handshake`): group sidecars into kind-based SUBFOLDERS (`questions/merge/`, `questions/stuck/`, ...), safe because kinds are temporally mutually-exclusive per item and the subfolder is a pure function of (kind, identity). That restructure + any `questions/` rename is its OWN ADR-worthy decision tracked by `task:questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21`; do NOT fold it into this PRD. (PRD sidecar Q5-ii.)

## Q4

**Should this task be HELD out of the build pool until the parent PRD `land-time-reverify-and-parallel-merge-ceiling` is re-decomposed against the binary-sidecar / agentic-apply model, with this task's body language reconciled in the same pass?**

> REVIEW lens 1 (claim-vs-reality) / lens 4 (coherence). The task body itself still says, in `## What to build` and in an acceptance criterion, that each merge-question is emitted "with a disposition choice of `merge | hold | drop`" — even while its own `## Open questions` block acknowledges the disposition vocabulary was retired and the surfacer must emit no token. The observation `work/notes/observations/merge-question-tasks-premised-on-retired-disposition-vocabulary-2026-06-25.md` (`needsAnswers: true`) names all three sibling tasks (`merge-question-surfacer`, `apply-rung-merge-disposition`, `merge-questions-gate-axis`) as premised on the retired vocabulary and its "Suggested next step" is: "Re-task `land-time-reverify-and-parallel-merge-ceiling` ... BEFORE any of its merge-question tasks are built. Until then these tasks should not be promoted to the build pool." The sibling sidecar `work/questions/task-merge-questions-gate-axis.md` Q4 reached the same hold conclusion.

_Suggested default: Hold this task out of the build pool and resolve it as part of the `land-time-reverify-and-parallel-merge-ceiling` re-decompose against the binary-sidecar / agentic-apply model (discharging the observation in the same pass). In that pass, rewrite `## What to build` and the acceptance criterion to drop the `merge | hold | drop` disposition-token language (already contradicted by the task's own Open questions), so the body matches the answer to Q1._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

The premise has now been RECONCILED in place (it does not need a separate re-decompose pass): the parent PRD `land-time-reverify-and-parallel-merge-ceiling` and all three merge-question task bodies have been amended in this pass against the binary-sidecar / deterministic-runner-action model (PRD sidecar Q1/Q2). This task's `## What to build` + scope bullet + acceptance criterion were already updated to drop the `merge | hold | drop` disposition-token language (replaced by "binary entry + deterministic-choice answer shape, no token") and to point at the runner-action apply layer. So: do NOT keep it premised on the retired vocabulary, and KEEP it in `tasks/backlog/` (not promoted) so it is built together with / before its siblings against the reshaped model. The observation `merge-question-tasks-premised-on-retired-disposition-vocabulary-2026-06-25` is discharged by this reconciliation (its signal now lives self-contained in the PRD + task bodies + these answers). needsAnswers clears once these answers apply.
