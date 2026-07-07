<!-- dorfl-sidecar: item=task:questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21 type=task slug=questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21 allAnswered=false -->

## Q1

**Decision B (the kind axis): how should question KIND (merge/stuck/triage/spec) be expressed going forward: keep it as today's filename PREFIX (`<type>-<slug>.md`, flat), promote it to a SUBFOLDER (`questions/<kind>/...`), or move it to a TYPED FIELD in the sidecar's identity HTML comment with per-kind queues rendered by the tool? This is the central buildable decision the task must resolve before any code is cut, and the observation explicitly says 'Do NOT guess the rename/restructure - surface it.'**

> Source observation 'Discussion round 2' CONCLUDED flat-vs-subfolder is a cosmetic/ergonomic non-difference for SAFETY (the silent-lookup hazard is about whether the path encodes a MUTABLE axis, not flat-vs-subfolder), and that kinds are TEMPORALLY mutually exclusive (spec -> [build] -> stuck OR merge), so the 'two kinds at once' hazard does not arise. Net guidance: 'decide on ERGONOMICS alone (no safety difference).' The earlier 'Lean' section's git-mv-safety framing was explicitly superseded/retracted by round 2.

_Suggested default: Keep FLAT, identity-keyed; express kind as a TYPED FIELD in the identity HTML comment (matching how `type`/`disposition` are already carried), and render per-kind queues via `status`/`scan`. This is the round-2 ergonomics-only safe default and preserves the load-bearing invariant that `sidecarPathFor(identity)` is a pure function of item identity (no mutable axis in the path)._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Decision B: keep FLAT and identity-keyed; express kind as a TYPED FIELD in the identity HTML comment (matching how `type` is already carried), and render per-kind queues via `status`/`scan`. This is the round-2 ergonomics-only safe default and preserves the load-bearing invariant that `sidecarPathFor(identity)` is a pure function of item identity, no mutable axis in the path. Do NOT promote kind to a subfolder (that would encode a mutable axis in the path).

## Q2

**Decision A (the rename), a SEPARATE question from B: should `work/questions/` be renamed (candidates: `inbox/`, `attention/`, `decisions/`, `pending/`), given that `work-layout.ts` already calls it 'the what needs me? queue' and most entries are decisions / a human-action inbox rather than literal questions? Is the rename in scope for THIS task, a separate follow-up, or declined?**

> Observation section A: low structural risk (one folder `git mv` + the `workFolderKey`/`sidecarPathFor` constant + CONTEXT/contract text). There is repo precedent for exactly this kind of move: ADR `rename-task-pool-folder-todo-to-ready.md`. The observation deliberately keeps A and B as 'two SEPARATE questions (do not conflate them)'.

_Suggested default: Treat A as a separate decision from B; keep the name `questions/` for now (decline/defer the rename) unless a human wants the churn, since B is the load-bearing structural call and A is a naming preference that can be a follow-up._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Decision A is separate from B (do not conflate). Decline/defer the folder rename for now: keep the name `questions/`. B is the load-bearing structural call; A is a naming preference (inbox/attention/pending) that can be a cheap follow-up ADR + git mv later if wanted, with precedent in rename-task-pool-folder-todo-to-ready. Not worth the churn as part of this task.

## Q3

**Should this decision be recorded as an ADR rather than just built as a slice? The observation says 'likely an ADR (folder structure is load-bearing here, status=folder)' and 'this is exactly the kind of structural call that should be a human/ADR decision, not an agent's.' If yes, what is the deliverable: an ADR doc, a code change, or both?**

> There is already an ADR family for layout/structure decisions, e.g. `docs/adr/question-sidecar-human-readable-format.md`, `work-tree-taxonomy-regime-umbrellas-and-per-regime-terminals.md`, `ledger-status-on-per-item-lock-refs.md`. The task frontmatter has no `covers`/`prd` and the body is a one-line stub, so the intended deliverable shape is unspecified.

_Suggested default: Record the chosen B (and A, if accepted) as an ADR in `docs/adr/`, then scope the code change (rename `questions/` folder reference and/or add the `kind` field + rendering) as the slice's acceptance, so the load-bearing structural decision is captured before code lands._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Yes, record the chosen B (the kind typed-field decision) as an ADR in docs/adr/, then scope the code change (add the `kind` field + per-kind rendering) as the slice's acceptance. Folder structure/status is load-bearing, so the structural decision must be captured before code lands. Deliverable = both (ADR doc + code change with tests). The keying question (Q6) must be resolved in the SAME ADR.

## Q4

**Open follow-up 1 (carried from the observation): should land/integrate (or a `gc` verb) ACTIVELY reconcile/clean stale+orphan sidecars, instead of relying on the downstream `needsAnswers <=> sidecar` invariant-violation HALT that catches but does not self-heal? Is this in scope for this task or a separate item?**

> Observation round-2 'OPEN QUESTIONS' Q1. Verified: `advance.ts` (~L859) returns exitCode 1 / `invariant-violation` and refuses to advance when the flag and sidecar disagree (the `sidecar-without-needsAnswers` violation); the LAND path (`integration-core.ts`/`complete.ts`/`needs-attention.ts`) has ZERO sidecar references and does no reconciliation; there is no auto-cleaner (`ledger-lint.ts` does not check this).

_Suggested default: Out of scope for this task (this task is about folder/kind layout); split the self-heal-vs-halt question into its own item rather than expanding this slice._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

Out of scope for this task (which is about folder/kind layout). Split the self-heal-vs-halt question (should land/gc actively reconcile stale+orphan sidecars vs relying on the downstream invariant-violation HALT) into its own separate item.

## Q5

**Open follow-up 2 (carried from the observation): should force-resolve paths (skip-verify / manual move-on) ALSO delete the sidecar, closing the orphan-source at creation rather than catching it later via the invariant violation? In scope here or a separate item?**

> Observation round-2 'OPEN QUESTIONS' Q2 (wighawag's root-cause fix for case (b)). The surviving real risk after round 2 is a human force-resolving and FORGETTING to delete the sidecar, leaving a stale ORPHAN that the next tick HALTS on but does not auto-heal. (Q3 was RETIRED: stale-CONTENT cannot survive rebase by git 3-way semantics, given the load-bearing invariant that a work branch NEVER authors a sidecar.)

_Suggested default: Out of scope for this layout task; track as a separate orphan-prevention item._

<!-- q5 fields: id=q5 -->

**Your answer** (write below this line):

Out of scope for this layout task. Track the force-resolve-should-delete-sidecar orphan-prevention question as a separate item (it pairs naturally with Q4's self-heal item).

## Q6

**Open follow-up 4 (carried, cross-cutting): the SIDECAR-KEYING question, can a sidecar key to a lock-ref/branch identity rather than only a file-path identity, shared with the merge-question and needs-attention notes? Must the keying decision be made TOGETHER with the folder/kind shape (B), or can B land independently?**

> Observation 'Cross-links' and round-2 OPEN QUESTION 4: shared with `work/notes/findings/advance-surface-apply-rungs-can-carry-merge-questions-for-unmerged-branches-2026-06-21.md` and `work/notes/observations/needs-attention-may-have-no-human-visible-outcome-after-lock-cutover-...md`. The observation states 'Folder shape + keying should be decided TOGETHER.' Note the round-2 CONSTRAINT: if merge-questions are ever authored against a BRANCH/lock-ref instead of `main`, it re-opens the both-sides-changed rebase conflict and breaks the no-branch-authorship invariant.

_Suggested default: Decide keying together with B at the ADR level (per the observation's own instruction), preserving the invariant that sidecar authorship stays on `main`/runner under the `advancing` lock._

<!-- q6 fields: id=q6 -->

**Your answer** (write below this line):

Decide keying TOGETHER with B at the ADR level, per the observation's own instruction. Preserve the invariant that sidecar authorship stays on `main`/runner under the `advancing` lock (never on a work branch). The round-2 constraint stands: if merge-questions are ever authored against a branch/lock-ref instead of main, it re-opens the both-sides-changed rebase conflict, so the ADR must hold the line that authorship stays on main even when the sidecar KEYS to a branch/lock-ref identity. This is the shared decision with the needs-attention surface-state brief (I routed that one to fold its keying question here too).

## Q7

**The task body is a one-line stub ('draft this into a buildable slice') with empty `blockedBy` and no `## Prompt`, no acceptance criteria, and no recorded decision, yet it sits in `tasks/ready/`. What is the concrete definition of done / acceptance for this slice once A and B are answered, so a build agent could start from the file alone?**

> Review lens 5 (destination check) + WORK-CONTRACT self-contained `## Prompt` requirement: the task as written delivers no mappable end-state. It cannot be built until the B (and A) decisions above are answered, which is precisely why it carries `needsAnswers: true`.

_Suggested default: Do not build yet; once A/B are answered, rewrite the task with a self-contained `## Prompt`, explicit acceptance (the ADR written + any rename/field/rendering code change with tests), and the relevant `blockedBy`/cross-link references._

<!-- q7 fields: id=q7 -->

**Your answer** (write below this line):

Do not build yet. Once A/B/keying are answered (all folded into one ADR), rewrite the task with a self-contained `## Prompt`, explicit acceptance (the ADR written + the `kind` field + per-kind rendering code with tests + `questions/` kept as-is), and any relevant blockedBy/cross-link references. The needsAnswers flag stays until that rewrite.
