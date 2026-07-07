---
title: review-gate non-blocking nits for 'route-answered-observation-sidecar-to-apply-pool' (Gate 2 approve)
date: 2026-07-07
status: open
reviewOf: route-answered-observation-sidecar-to-apply-pool
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'route-answered-observation-sidecar-to-apply-pool' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Un-recorded in-scope decision: 'an answered observation sidecar wins even when the body carries a triaged: marker' (i.e. answered-sidecar dominates the settled marker in apply routing). The task prompt EXPLICITLY called this out as the canonical decision to record, and the code comments in lifecycle-pools.ts reference 'task ## Decisions' — but the task file has NO ## Decisions block. Ratify or reverse; if kept, add the block so future readers see WHY answered wins over triaged: (a human's answer must never be stranded).
  (work/tasks/done/route-answered-observation-sidecar-to-apply-pool.md has no Decisions section; lifecycle-pools.ts new apply branch + test 'an ANSWERED sidecar wins even when the observation is ALSO triaged:' encode the choice.)
- Acceptance criterion (c) — 'end-to-end apply of a fully-answered observation produces the decided artifact and removes source+sidecar' — has no NEW test added in this diff (only classifier + mirror-gather parity tests). The apply path is exercised by pre-existing triage-persist / apply-persist tests, but no test asserts the newly-wired classifier→apply→agentic-decide chain for an observation end-to-end. Consider adding one throwaway-git-repo test to lock in the promise.
  (Diff adds tests only to lifecycle-pools.test.ts and advance-autopick-lifecycle-mirror.test.ts; no new triage-persist-style E2E for the answered-observation apply path.)
- Silent behaviour change: a SETTLED observation (triaged: set) with a PENDING sidecar now falls through the else and is NOT enumerated in either pool — previously the pending sidecar was invisible anyway, so behaviour is unchanged for users, but this branch is worth a one-line comment or a dropped-item assertion so no future reader thinks pending-sidecar-on-settled-observation should re-surface.
  (lifecycle-pools.ts new loop: '// else: SETTLED (triaged:) with no answered sidecar — NOT enumerated.' correctly drops it but only in a trailing comment.)
