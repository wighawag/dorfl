<!-- dorfl-sidecar: item=observation:review-nits-recovery-rebase-retry-against-moving-arbiter-main-2026-06-24 type=observation slug=review-nits-recovery-rebase-retry-against-moving-arbiter-main-2026-06-24 allAnswered=false -->

## Q1

**What becomes of this observation overall — the durable home for the Gate-2 non-blocking nits on 'recovery-rebase-retry-against-moving-arbiter-main'? Should it be promoted into a small follow-up task, kept open as a triage record, or closed/deleted once the individual nits below are dispositioned?**

> Observation file work/notes/observations/review-nits-recovery-rebase-retry-against-moving-arbiter-main-2026-06-24.md, status: open, needsAnswers: true. The PR/code review gate (Gate 2) APPROVED the work; these are non-blocking nits parked here for triage. PR #225 (this task) LANDED. One of the four original bullets (the rename-detection cross-task interaction) is already SUPERSEDED by the in-file Update: the sibling is parked in work/tasks/backlog/disable-rename-detection-on-continue-rebase.md carrying the corrected `merge.directoryRenames=false` CORRECTION banner (verified present), so it is no longer open here. The remaining residue is the three nits below.

_Suggested default: Keep the observation open as the triage record; disposition the three remaining nits individually (a single small doc/follow-up task captures the actionable ones), then close it._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**The acceptance criterion required a `## Decisions` block on the done record / PR / ADR (cap + why; contention-vs-outage; jitter; reconcile-arms; rename-detection orthogonality), but the done task file has no such block and the decisions live only in code comments in integration-core.ts. Should the `## Decisions` block be transcribed into the protocol-native location, and if so where (done task file vs PR description vs an ADR)?**

> Verified: work/tasks/done/recovery-rebase-retry-against-moving-arbiter-main.md has only sections 'What to build' / 'Acceptance criteria' (line 161) / 'Blocked by' / 'Prompt' — no '## Decisions' heading. The acceptance criterion (line 212) and the prompt instruction (line 340) both require one. The decisions ARE thoroughly recorded, but only in code comments (DEFAULT_RECOVERY_REBASE_RETRIES doc-comment, jitter doc-comment, and the block above the retry loop at integration-core.ts:1701). Commit body is empty.

_Suggested default: Transcribe the decisions into a `## Decisions` block on the done task file (it is already merged, so an in-repo doc edit is the protocol-native home), sourced verbatim from the existing code comments._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Ratify the chosen retry cap: `DEFAULT_RECOVERY_REBASE_RETRIES = 4` (5 total attempts). Is 4 the value you want landing in default recovery behaviour, or should it be anchored to something more empirical?**

> Verified at integration-core.ts:244. The task said 'small bounded cap … a few attempts ride out an advance burst'; 4 is plausible but picked without an empirical anchor (the live incident quantifies bursts only qualitatively as 'tens of commits over a few seconds'). Contrast the Race-1 cap of 1000, which is a deliberately different shape (a liveness ceiling, not a contention cap).

_Suggested default: Ratify 4 as-is; it is a conservative contention cap and is overridable via params.recoveryRebaseRetries (integration-core.ts:1628). Revisit only if a real incident shows bursts outlasting 5 attempts._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Ratify the in-scope reconcile-arms decision: the recovery re-rebase is left deliberately BARE (no `rebaseOntoMainWithReconcile()` arms). Do you confirm this load-bearing decision?**

> Recorded in the source comment at integration-core.ts:1701 ('RECONCILE ARMS DECISION (this task): the recovery rebase is deliberately BARE …'). Rationale: the done-move was already committed upstream so divergent-done-move has nothing to act on, and a sibling-ledger conflict on a re-fetched main is the same shape the original run would have hit. Reasoning is sound but the decision is load-bearing (the acceptance criterion at done-task lines 204-208 required it be explicitly DECIDED, not silently bare).

_Suggested default: Confirm the bare recovery rebase; the recorded rationale holds. If later a divergent-done-move case is observed in the recovery path, reuse the SAME reconcile path (no second copy) per the task's own instruction._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

## Q5

**Should the module-local two-sleep-primitive split be unified as a follow-up? Race-1 jitter still uses the local non-injectable `sleepMs` while the new recovery loop uses the injectable `Sleep` seam from retry-backoff.ts.**

> Verified: `sleepMs` is defined at integration-core.ts:216 and used by the Race-1 jitter at line 1473; the recovery loop uses the `Sleep` seam (RNG also injected). The doc-comment on sleepMs notes the split was kept 'for byte-for-byte compatibility with existing tests'. The new seam is strictly better; this is an acceptable localised choice flagged as a convenience follow-up, not a defect.

_Suggested default: Defer as a low-priority cleanup follow-up: unify Race-1 jitter onto the same `Sleep` seam when next touching that code; do not mint dedicated work just for this._

<!-- q5 fields: id=q5 -->

**Your answer** (write below this line):
