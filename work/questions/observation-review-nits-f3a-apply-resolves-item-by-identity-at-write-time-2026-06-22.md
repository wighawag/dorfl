<!-- dorfl-sidecar: item=observation:review-nits-f3a-apply-resolves-item-by-identity-at-write-time-2026-06-22 type=observation slug=review-nits-f3a-apply-resolves-item-by-identity-at-write-time-2026-06-22 allAnswered=false -->

## Q1

**What becomes of this signal? The observation is a triage home for three NON-BLOCKING review nits raised when Gate 2 APPROVED 'f3a-apply-resolves-item-by-identity-at-write-time'. None blocks integration. What should happen to it: delete it (concerns now addressed/moot), keep it as a record, or promote any surviving nit into a follow-up task/ADR?**

> work/notes/observations/review-nits-f3a-apply-resolves-item-by-identity-at-write-time-2026-06-22.md (status: open, needsAnswers: true). The body's own framing is 'this is their durable home for triage - promote-to-slice / keep / delete.' The three nits are: (1) unify APPLY_LIFECYCLE_FOLDERS vs FOLDERS_FOR_TYPE; (2) ratify the terminal-folder -> 'vanished' interpretation; (3) the done record carries no ## Decisions block. See the per-nit questions below for current-reality status of each.

_Suggested default: Delete the observation. Investigation against current code shows the headline nit (#1) is already resolved and the remaining two are minor/ratified, so the durable record has served its purpose; if you want #2 or #3 tracked, promote that one into a follow-up rather than keeping the whole nit-bag open._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Nit #1 (now likely STALE): should APPLY_LIFECYCLE_FOLDERS (item-path.ts) and FOLDERS_FOR_TYPE (advance.ts) be unified, or is the concern moot because they were since brought into step?**

> The observation flagged the two lifecycle-folder sets as 'two sets of truth' that might diverge: at observation time (2026-06-22) advance.ts's set excluded staging folders while apply's included them. As of current code they are BYTE-IDENTICAL (both task: ['tasks-backlog','tasks-ready','in-progress','done'], prd: ['prds-proposed','prds-ready','prds-tasked'], observation: ['observations']) - packages/dorfl/src/item-path.ts:34-41 and packages/dorfl/src/advance.ts:426-430. advance.ts's comment (lines 420-424) now explicitly says it is 'the staging-inclusive set its sibling apply-persist.ts (APPLY_LIFECYCLE_FOLDERS) already uses - kept in step here', via the follow-up task 'advance-task-folder-set-omits-tasks-backlog-staged-surface-items-misroute-to-build' (tracked in observation dated 2026-06-24). They are still two SEPARATE constants, just identical in content.

_Suggested default: Mark as resolved/moot: the asymmetry the nit worried about is gone (the two sets are now identical and documented as kept-in-step). If a single source of truth is still wanted, that is a tiny optional refactor (extract one shared constant), not a divergence risk worth a task today._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Nit #2: ratify that treating an item moved to a TERMINAL folder (cancelled / briefs-dropped / needs-attention) between capture and write as 'vanished' (clean exit, no commit, sidecar UNTOUCHED) is the intended reading of acceptance criterion 4, which only spoke of 'removed entirely'?**

> packages/dorfl/src/item-path.ts: APPLY_LIFECYCLE_FOLDERS excludes terminal-only folders, so a terminalised item is not re-resolved and the apply takes the 'vanished' clean-exit path (sidecar left untouched, rerunnable). The observation notes this is the recorded design (code comment + a 'VANISHED: ... sidecar UNTOUCHED' test) and that extending 'vanished' from 'removed entirely' to 'reached a terminal' is a slightly broader-but-reversible interpretation. This is a non-blocking nit; review APPROVED the gate.

_Suggested default: Ratify as-is: the behaviour is reversible (sidecar untouched, human can rerun) and test-pinned, so the broader reading is safe; no change needed._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Nit #3: is the recordkeeping gap acceptable - the slice asked the agent to RECORD non-obvious in-scope decisions in the done record, but the done file has no ## Decisions block and commit 67bed45's body is empty (the decisions exist only as code comments)?**

> Confirmed against current tree: work/tasks/done/f3a-apply-resolves-item-by-identity-at-write-time.md contains no '## Decisions' / '## Decision' heading. The decisions (resolver reuse vs extension, the gone-item exit, brief carve-out) are present as JSDoc/code comments (APPLY_LIFECYCLE_FOLDERS JSDoc, the 'vanished' docstring, the F3a comment block). So nothing is hidden, but it was not surfaced where reviewers ratify. Not a code defect - a process/recordkeeping miss on an already-done, integrated task.

_Suggested default: Accept and close: the task is done and integrated and the decisions are discoverable in code; backfilling the done record adds little. Optionally note the lesson for future slices (record decisions in the done body, not only as comments) rather than reopening this one._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):
