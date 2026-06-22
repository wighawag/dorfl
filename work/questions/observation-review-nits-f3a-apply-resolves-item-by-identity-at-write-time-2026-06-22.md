<!-- agent-runner-sidecar: item=observation:review-nits-f3a-apply-resolves-item-by-identity-at-write-time-2026-06-22 type=observation slug=review-nits-f3a-apply-resolves-item-by-identity-at-write-time-2026-06-22 allAnswered=false -->

## Q1

**What disposition for this observation collecting the three non-blocking Gate-2 review nits on f3a-apply-resolves-item-by-identity-at-write-time?**

> Observation is the durable home for nits the Gate-2 review APPROVED but did not block on. Three findings:
>   1. Two lifecycle-folder constants of truth (APPLY_LIFECYCLE_FOLDERS in apply-persist.ts vs FOLDERS_FOR_TYPE in advance.ts) — deliberate asymmetry (apply re-resolver must see staging in case a concurrent promote moved item OUT of staging) but worth unifying or explicitly ratifying.
>   2. `vanished` treatment was extended to 'reached a terminal' beyond the slice's 'removed entirely' criterion — design is recorded as a code comment and sidecar-untouched test, but the broader reading deserves explicit ratification.
>   3. Slice prompt asked for a `## Decisions` block in the done record — the moved done file is byte-identical to the task and commit body is empty; decisions live as code comments only. Recordkeeping gap, not a code defect.
> None block integration; the question is purely 'what becomes of this signal' (promote a follow-up slice for the unification / keep as a recorded ratification / delete as already-handled-in-code).

_Suggested default: promote-slice — finding #1 (the dual FOLDERS_FOR_TYPE / APPLY_LIFECYCLE_FOLDERS constants) is a real coherence smell that will diverge silently; a small slice to either unify them or pin the asymmetry behind a single named function is honest follow-up work. Findings #2 and #3 fold in as ratification/recordkeeping items in that slice's brief, or are answered by the per-finding questions below._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Ratify: should APPLY_LIFECYCLE_FOLDERS (apply-persist.ts) and FOLDERS_FOR_TYPE (advance.ts) be unified, or is the staging-inclusive vs staging-exclusive asymmetry the intended permanent shape?**

> packages/agent-runner/src/apply-persist.ts:30-37 vs packages/agent-runner/src/advance.ts:376-380. Apply's set deliberately includes staging folders (`tasks-backlog`, `briefs-proposed`) so the re-resolver can see a concurrent promote that just moved the item OUT of staging — the F2 staging-surfacing case this prefactor enables. Advance's set is staging-exclusive. The slice prompt asked the agent to 'reuse the resolver's shape rather than inventing a new one'; sidecarPathFor's identity shape was reused, but the folder list forked.

_Suggested default: Keep the asymmetry but express it as one function: e.g. lifecycleFoldersFor(type, { includeStaging: boolean }) with a single source of truth and the two call-sites passing the flag. Captures the intentional difference without two parallel constants._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Ratify: extending `vanished` to mean 'reached a terminal folder (cancelled / briefs-dropped / needs-attention)' between capture and write — is that the intended interpretation of acceptance criterion 4 ('item removed entirely')?**

> packages/agent-runner/src/apply-persist.ts:20-29, 386-400; test 'VANISHED: ... sidecar UNTOUCHED'. Terminal-only folders are excluded from the apply re-resolver, so a concurrent terminal-move surfaces as `vanished` (clean exit, no commit, sidecar untouched, human can rerun). Recorded as a code comment; not in the done record's Decisions block (because there is no Decisions block — see next finding).

_Suggested default: Yes — treating a terminal as 'vanished from the apply path' is the correct generalisation: the item is no longer in a state where apply should write to it, and leaving the sidecar untouched keeps the operation reversible. Worth stating once in the brief/ADR for the slice that promotes finding #1._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Should the slice contract require (or the runner enforce) that the done record carry a `## Decisions` block when the prompt asked the agent to record non-obvious in-scope decisions, rather than relying on the agent to add it?**

> work/tasks/done/f3a-apply-resolves-item-by-identity-at-write-time.md is byte-identical to the original task — no `## Decisions` block — and the commit body (67bed45) is empty. The decisions DO exist as code comments (APPLY_LIFECYCLE_FOLDERS JSDoc, ApplyTerminal `vanished` docstring, F3a comment block in applyAnsweredQuestions), so nothing is hidden, but they were not surfaced where reviewers ratify them. The slice prompt explicitly asked for this and the agent did not comply.

_Suggested default: Out of scope for the follow-up slice on finding #1; track as a separate process observation if it recurs. A single missed recordkeeping step on one slice is not yet a pattern worth hardening the contract around._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):
