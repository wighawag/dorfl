---
title: review-gate non-blocking nits for 'run-daemon-reframe' (Gate 2 approve)
date: 2026-06-07
status: open
slug: run-daemon-reframe
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'run-daemon-reframe' but raised the following non-blocking findings (nits). They do not block integration; this is their durable home for batch-qa triage (promote-to-slice / keep / delete).

- The settled-slot fallback in runOnce maps any uncaught worker throw to status 'claim-error' (run.ts ~line 327). runOneItem is documented as total (never throws), so this branch should be dead — but if it ever fires it will surface a real internal bug (e.g. a future refactor that lets an exception escape runOneItem) as an innocuous-looking 'claim-error' item, which a human reading the summary would likely dismiss as a benign lost/contended claim. Consider distinguishing it (e.g. a distinct 'internal-error' status, or onWarn-logging the captured error) so a genuine defect isn't camouflaged as a routine claim outcome. (run.ts: `const items = settled.map((slot, i) => 'ok' in slot ? slot.ok : {..., status: 'claim-error', detail: (slot.error as Error)?.message})`. concurrency.ts runConcurrent never rejects (captures {error}); the only producer of an {error} slot here would be an unexpected throw out of the supposedly-total runOneItem.)
- The fix to claim-cas.ts (detach onto arbiter/main before delete+recreate of the claim branch) is correct and required, but its only direct coverage is via the higher-level merge-mode same-repo concurrency tests in run.test.ts / run-loop.test.ts (which exercise the retry path indirectly when a sibling's merge advances main). There is no unit test that drives performClaim's retry branch in isolation to pin the idempotent branch-reset across attempts. Given this is a subtle, concurrency-only-surfacing bug, a focused regression test on the retry path would harden it against future edits to the attempt() preamble. (claim-cas.ts attempt(): the new `git checkout --detach arbiter/main` precedes `git branch -D claimBranch` + `git checkout -b claimBranch`. The retry loop is `while(true){ attempt() }` with `rejected` looping again — on the 2nd attempt HEAD is still on claimBranch from attempt 1, which is exactly what the detach guards. Coverage is currently emergent (via concurrent integration tests), not a dedicated unit.)
