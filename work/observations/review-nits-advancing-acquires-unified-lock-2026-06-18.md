---
title: review-gate non-blocking nits for 'advancing-acquires-unified-lock' (Gate 2 approve)
date: 2026-06-18
status: open
reviewOf: advancing-acquires-unified-lock
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'advancing-acquires-unified-lock' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- runRelease has no catch-and-release of the unified lock if releaseAttempt throws (a plumbing error during marker deletion), unlike runAcquire which has an explicit catch that releases. Is leaving the unified lock held on a release-side throw the intended recovery posture?
  (In advancing-lock.ts runRelease, the try/finally has no catch around the release loop, whereas runAcquire added a catch that calls releaseHeldUnifiedLock before re-throwing. On a release-side throw the item is left with BOTH the marker and the unified lock present (i.e. still held, recoverable via the human release-lock + gc path the ADR prescribes), so it does not orphan-and-lose state - which is why this is non-blocking. Worth a human nod that 'a failed release leaves the item held' is the deliberate, ADR-consistent behaviour rather than an oversight.)
- Ratify the in-scope decision: on a release-path 'contended' (exit 3) terminal state the unified lock is intentionally KEPT (only 'released' and marker-'lost' release it), so a contended release leaves the advance hold in place for a later retry. The PR carried no explicit ## Decisions block; this choice is documented only in a code comment.
  (advancing-lock.ts runRelease releaseHeldUnifiedLock site: 'only contended (the marker may still be present) keeps it.' This is a sensible, user-visible default (a half-finished release does not drop the lock while the marker may still be on main), and is consistent with the acquire-side ordering, but it is an in-scope design choice the slice did not spell out, so flag it for ratification.)
