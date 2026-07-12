---
title: review-gate non-blocking nits for 'jitter-and-widen-cas-contention-retry-for-lifecycle-fanout' (Gate 2 approve)
date: 2026-07-07
status: open
reviewOf: jitter-and-widen-cas-contention-retry-for-lifecycle-fanout
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'jitter-and-widen-cas-contention-retry-for-lifecycle-fanout' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the AWS-style decorrelated-jitter shape and the LIFECYCLE_CAS_CONTENTION defaults (retries=32, initialDelayMs=25, maxDelayMs=2000, maxTotalMs=30_000). Reasonable in-scope choices, but they are load-bearing tuning numbers with no separate ADR — recorded only in the Decisions block at the bottom of advancing-lock.ts.
  (packages/dorfl/src/advancing-lock.ts LIFECYCLE_CAS_CONTENTION + trailing Decisions section)
- Ratify the widened contention-loop applying to BOTH promote (triage-persist) AND mint-adr legs from advance.ts. The task lists 'lifecycle/treeless-apply path'; adding LIFECYCLE_CAS_CONTENTION to mint-adr is a small in-scope expansion worth explicit human sign-off.
  (packages/dorfl/src/advance.ts adds contention: LIFECYCLE_CAS_CONTENTION at both promoteObservation and mintAdr call sites)
- Ratify the new public API surface: CasContentionBudget, runCasContentionLoop, nextCasContentionDelayMs, INTERACTIVE_CAS_CONTENTION, LIFECYCLE_CAS_CONTENTION, CasAttemptResult, CasContentionLoopResult are all re-exported from src/index.ts. Task did not require exposing the primitive at the top-level API; interactive/single-item defaults are preserved so this is backwards-compatible, but it enlarges the surface library consumers can depend on.
  (packages/dorfl/src/index.ts adds 5 exports + 3 type exports)
- Ratify the slightly changed user-visible message on wall-clock exhaustion ('push rejected N times (main is contended; wall-clock budget Xms exhausted). Try again shortly.') — a new refusal-flavour message distinct from the classic attempts-cap message.
  (packages/dorfl/src/advancing-lock.ts runCasContentionLoop wall-clock branch)
