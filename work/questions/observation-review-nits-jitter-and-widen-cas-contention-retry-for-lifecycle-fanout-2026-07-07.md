<!-- dorfl-sidecar: item=observation:review-nits-jitter-and-widen-cas-contention-retry-for-lifecycle-fanout-2026-07-07 type=observation slug=review-nits-jitter-and-widen-cas-contention-retry-for-lifecycle-fanout-2026-07-07 allAnswered=false -->

Item: [`observation:review-nits-jitter-and-widen-cas-contention-retry-for-lifecycle-fanout-2026-07-07`](../notes/observations/review-nits-jitter-and-widen-cas-contention-retry-for-lifecycle-fanout-2026-07-07.md)

## Q1

**What becomes of this observation as a whole — keep as a durable note, promote any of its four nits to follow-up tasks/ADRs, or delete now that the code has landed and the numbers are in-tree?**

> Observation home: work/notes/observations/review-nits-jitter-and-widen-cas-contention-retry-for-lifecycle-fanout-2026-07-07.md. Source task landed at work/tasks/done/jitter-and-widen-cas-contention-retry-for-lifecycle-fanout.md; all four nits are non-blocking Gate-2 approvals awaiting durable disposition.

_Suggested default: Delete: the four sub-items below are individually ratifiable in-place; no residual signal survives once each is addressed._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Ratify the AWS-style decorrelated-jitter shape and LIFECYCLE_CAS_CONTENTION tuning defaults (retries=32, initialDelayMs=25, maxDelayMs=2000, maxTotalMs=30000), or mint a dedicated ADR for these load-bearing numbers?**

> packages/dorfl/src/advancing-lock.ts LIFECYCLE_CAS_CONTENTION constant + trailing Decisions block. Confirmed present in current tree (lines 397, 415, 1050). No separate ADR file records the shape/numbers.

_Suggested default: Ratify in place; the trailing Decisions block plus JSDoc is adequate durable rationale for tuning constants._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Ratify widening the contention loop to BOTH the promote (triage-persist) AND the mint-adr legs from advance.ts (task scope only named the treeless-apply/lifecycle path)?**

> packages/dorfl/src/advance.ts passes contention: LIFECYCLE_CAS_CONTENTION at both promoteObservation and mintAdr call sites — a small in-scope expansion beyond the literal task text.

_Suggested default: Ratify: both legs are lifecycle fan-out and share the same contention envelope by design._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Ratify enlarging the public API surface with CasContentionBudget, runCasContentionLoop, nextCasContentionDelayMs, INTERACTIVE_CAS_CONTENTION, LIFECYCLE_CAS_CONTENTION, CasAttemptResult, CasContentionLoopResult (task did not require exposing the primitive)?**

> packages/dorfl/src/index.ts lines 286–289 add 5 value exports + 3 type exports. Backwards-compatible (interactive defaults preserved) but enlarges the consumer-visible surface.

_Suggested default: Ratify: exposing the primitive lets downstream drivers reuse the same contention envelope instead of reinventing it._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

## Q5

**Ratify the new user-visible refusal message on wall-clock exhaustion ('push rejected N times (main is contended; wall-clock budget Xms exhausted). Try again shortly.') as a distinct flavour from the classic attempts-cap message?**

> packages/dorfl/src/advancing-lock.ts runCasContentionLoop wall-clock branch — introduces a second refusal phrasing distinguishable from the attempts-cap message.

_Suggested default: Ratify: the two exhaustion modes carry different diagnostic value, so distinct messages help operators._

<!-- q5 fields: id=q5 -->

**Your answer** (write below this line):
