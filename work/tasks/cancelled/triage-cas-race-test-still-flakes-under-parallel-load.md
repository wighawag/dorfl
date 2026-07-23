---
title: 'triage-cas-race-test-still-flakes-under-parallel-load'
slug: triage-cas-race-test-still-flakes-under-parallel-load
blockedBy: []
reason: already-delivered
---

## What to build

Promoted from observation `observation:triage-cas-race-test-still-flakes-under-parallel-load`. A human answered
"promote": draft this into a buildable task.

## Cancelled 2026-06-25 (already-delivered)

The fix this task was promoted to do (serialise the CAS-race tests, option (a)
from the source observation: add them to the `RACE_SENSITIVE` / `fileParallelism:
false` project) ALREADY LANDED via the slice `cas-create-nonce-authoritative-same-identity`.
Verified on `main` 2026-06-25: `packages/dorfl/vitest.config.ts:171-172` lists
BOTH `test/advance-triage.test.ts` and `test/triage-persist.test.ts` in
`RACE_SENSITIVE` (the `fileParallelism: false` project). Building this task as
scoped would be a no-op.

The flake was REPRODUCED-AGAINST before cancelling: the two CAS-race files ran
5/5 clean in isolation, and the FULL suite ran 2/2 clean under parallel load
(185 files / 2682 tests, 0 failures) on 2026-06-25. So the flake is gone, not
merely masked.

Discharged the source observation
`triage-cas-race-test-still-flakes-under-parallel-load` alongside this cancel.
(Sweep finding D2; human-authorised.)
