<!-- agent-runner-sidecar: item=observation:review-nits-recovery-rebase-retry-against-moving-arbiter-main-2026-06-24 type=observation slug=review-nits-recovery-rebase-retry-against-moving-arbiter-main-2026-06-24 allAnswered=false -->

## Q1

**Nit #1 — what becomes of the missing `## Decisions` block on the done task file (the acceptance criterion required it, but the decisions live only in `integration-core.ts` source comments)?**

> Finding #1: done file `work/tasks/done/recovery-rebase-retry-against-moving-arbiter-main.md` has no `## Decisions` heading; commit d1ab93c body is empty; the task's own acceptance line (line 202) required this block to record cap chosen, contention-vs-outage, jitter, reconcile-arms decision, and rename-detection orthogonality. The decisions ARE recorded in code comments (DEFAULT_RECOVERY_REBASE_RETRIES doc-comment, DEFAULT_RECOVERY_REBASE_JITTER_MS doc-comment, the block above the retry loop) — they just live in the wrong place per the protocol.

_Suggested default: promote-task — small follow-up task to transcribe the in-code decisions into a `## Decisions` block on the done task file (the protocol-native location)._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):

## Q2

**Nit #2 — do you ratify `DEFAULT_RECOVERY_REBASE_RETRIES = 4` (5 total attempts) as the shipped default, or do you want it changed?**

> Finding #2: cap chosen without an empirical anchor — the live incident only quantifies bursts qualitatively as 'tens of commits over a few seconds'. The Race-1 cap is 1000 (a liveness ceiling, deliberately different shape), so this 4 is a small bounded ride-out cap. Reviewer flags for human ratification because the value lands in default behaviour. Source: packages/agent-runner/src/integration-core.ts:247.

_Suggested default: keep — 4 is plausible for a ride-out-an-advance-burst cap; ratify as-is and record the ratification in the `## Decisions` block from Nit #1._

<!-- q2 fields: id=q2 disposition=keep -->

**Your answer** (write below this line):

## Q3

**Nit #3 — do you ratify the load-bearing decision that the recovery re-rebase is BARE (no `rebaseOntoMainWithReconcile()` arms)?**

> Finding #3: rationale (recorded in the source block-comment 'RECONCILE ARMS DECISION (this task): the recovery rebase is deliberately BARE …') is that the done-move was already committed upstream so divergent-done-move has nothing to act on, and a sibling-ledger conflict on a re-fetched main is the same shape the original run would have hit. Reviewer found the reasoning sound but flags it because the decision is load-bearing.

_Suggested default: keep — confirm the bare-rebase decision and record the ratification in the `## Decisions` block from Nit #1._

<!-- q3 fields: id=q3 disposition=keep -->

**Your answer** (write below this line):

## Q4

**Nit #4 — how do you want to handle the cross-task interaction with the still-OPEN PR #224 `disable-rename-detection-on-continue-rebase` (whoever merges second must add `-c merge.renames=false` / `-Xno-renames` to the `rebaseArgs()` thunk and re-run the moving-base tests)?**

> Finding #4: this task wrote the rebase call as a `rebaseArgs()` thunk specifically so rename-off can 'slot in cleanly at ONE site' (good), but the done record is missing the required 'sibling has NOT landed yet' note. `gh pr list` shows PR #224 OPEN as of 2026-06-24. The merge order matters and the coordination step is currently unrecorded.

_Suggested default: promote-task — small coordination follow-up: add the 'sibling not yet landed' line to the done record now, and capture a checklist item for whoever merges second to add rename-off flags at the `rebaseArgs()` site and re-run moving-base tests with renames off._

<!-- q4 fields: id=q4 disposition=promote-task -->

**Your answer** (write below this line):

## Q5

**Nit #5 — do you want to unify the Race-1 jitter (still using the local non-injectable `sleepMs`) onto the same `Sleep` seam the new recovery loop uses (from `retry-backoff.ts`)?**

> Finding #5: two sleep primitives now coexist in `integration-core.ts`. Race-1's `sleepMs` was kept 'for byte-for-byte compatibility with existing tests'; the new recovery seam is strictly better (RNG also injected). Reviewer marks it acceptable as a localised choice and suggests a follow-up note.

_Suggested default: promote-task — low-priority cleanup task to migrate Race-1 jitter onto the injectable `Sleep` seam and retire `sleepMs`, when convenient._

<!-- q5 fields: id=q5 disposition=promote-task -->

**Your answer** (write below this line):
