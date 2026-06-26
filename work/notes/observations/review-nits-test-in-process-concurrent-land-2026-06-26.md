---
title: review-gate non-blocking nits for 'test-in-process-concurrent-land' (Gate 2 approve)
date: 2026-06-26
status: open
reviewOf: test-in-process-concurrent-land
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'test-in-process-concurrent-land' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify in-scope tightening: the task allows the loser to EITHER land cleanly OR end 'stuck' with a real cause, but the disjoint+green-verify scenario lets the test pin the stricter 'both must land claimed-done' assertion. Intentional (regression-sensitive), but it is an unrecorded design choice — no Decisions block in the PR / task body.
  (test asserts result.claimedAndDone === 2 and every item.status === 'claimed-done'; the broader allowed set (needs-attention/tests-failed) is checked first but then narrowed.)
- The final 'verify never lands a broken tree on main' check shells out `sh -c 'exit 0'` against the post-land tip — trivially green by construction and so adds little signal beyond what the green-engine path already gives. Consider asserting a non-trivial verify (e.g. content/marker) in a follow-up, or drop the re-run.
  (lines re: `const verifyRun = spawnSync('sh', ['-c', PASS] ...)` near end of test; comment already acknowledges the circularity.)
- Per-item lock read post-land uses `readItemLock` and only asserts `state !== 'stuck'` when defined — the task says the loser must not be bounced for 'lock contention' alone. A stronger guard would also assert the lock `reason` (if present) does not mention lock/contention. Optional.
  (`if (lock !== undefined) expect(lock.state).not.toBe('stuck');` — reason-string check omitted.)
