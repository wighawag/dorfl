<!-- dorfl-sidecar: item=observation:review-nits-apply-rung-merge-disposition-2026-06-28 type=observation slug=review-nits-apply-rung-merge-disposition-2026-06-28 allAnswered=false -->

## Q1

**Nit 1 — restale re-surface APPENDS a new kind:merge follow-up instead of clearing the prior answer=merge on the original entry, so detectAnsweredMergeAction (which returns the FIRST answered merge entry) will re-fire against the stale answer on the next apply run. Ratify the append-and-history shape, switch to clear-the-answer semantics, or promote a task to change detectAnsweredMergeAction to prefer the LATEST entry?**

> apply-merge-action.ts detectAnsweredMergeAction loops entries and returns the first match; advance.ts maybeRunMergeAction restale branch uses appendQuestions with kind:merge. q1 originally said 'clears the answer back to no-answer and re-surfaces'; the shipped shape is a reinterpretation. Both files still exist and still carry this behaviour.

_Suggested default: Promote to task: change detectAnsweredMergeAction to return the LATEST answered merge entry (or prefer unanswered follow-ups first), so the re-surfaced question — not the stale answer — drives the next apply run._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Nit 2 — a refused merge-action is mapped to rung outcome 'usage-error'. performIntegration already routes the bounce to needs-attention, so this is purely the rung-level signal, but 'usage-error' is an odd label for 'red re-verify on the rebased tip refused the land'. Confirm this matches how other performIntegration-routed refusals are labelled at the rung layer, or rename to a more accurate outcome?**

> advance.ts maybeRunMergeAction returns outcome:'usage-error' on result.outcome==='refused'. The label collides with genuine caller-usage errors emitted by other rungs.

_Suggested default: Promote to a small task: audit the outcome vocabulary across advance rungs and either reuse the existing needs-attention/refused outcome tag or introduce a dedicated 'merge-refused' outcome; keep exitCode:1._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Nit 3 — the workspacesDir guard (clean refusal when workspacesDir is unset AND no test mergeAction is injected) is a new user-visible error path the task spec did not name explicitly. Record it as a decision (ADR / task-spec addendum) so a future caller that forgets to thread workspacesDir gets the documented refusal instead of a silent skip, or keep as a code-local invariant?**

> advance.ts maybeRunMergeAction: workspacesDir===undefined && mergeAction===undefined ⇒ usage-error with explanatory message. Defensive and correct; undocumented at the protocol layer.

_Suggested default: Keep as observation and fold a one-line note into the advance rung's contract doc (no task needed); the guard itself is fine._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Nit 4 — createJob is called with hard-coded type:'task'. Today the surfacer only emits merge-questions for tasks, but if a kind:merge sidecar is ever stamped on a non-task item (e.g. a prd-level unmerged branch) the branch name work/task-<slug> will silently mis-target. Add an assertion / thread the source item's type through, or leave a comment and defer?**

> apply-merge-action.ts performMergeAction: createJob({slug, type:'task', ...}). Assumption is currently safe by construction but not enforced.

_Suggested default: Promote a tiny task: assert at performMergeAction entry that the sidecar's source item is a task (throw a clear error otherwise), so a future surfacer change fails loudly instead of building the wrong branch name._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):
