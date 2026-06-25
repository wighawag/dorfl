<!-- dorfl-sidecar: item=task:triage-cas-race-test-still-flakes-under-parallel-load type=task slug=triage-cas-race-test-still-flakes-under-parallel-load allAnswered=false -->

## Q1

**The fix this task was promoted to do (its source observation's applied answer chose "option (a): serialise the test" via the RACE_SENSITIVE precedent) appears ALREADY DONE. Is there any residual work left, or should this task be cancelled as already-delivered?**

> packages/dorfl/vitest.config.ts:171-172 already lists BOTH 'test/advance-triage.test.ts' and 'test/triage-persist.test.ts' in the RACE_SENSITIVE array (fileParallelism:false project, lines 26 + 230-231), so the same-slug-race tests already run serialised OUT of file-parallel pressure. The in-file comment (lines 156-170) attributes their addition to a DIFFERENT slice, 'cas-create-nonce-authoritative-same-identity', not to this task. This is a claim-vs-reality / drift block (REVIEW-PROTOCOL lens 1; WORK-CONTRACT 'drift is a needs-attention signal'): building the task as scoped (= add it to RACE_SENSITIVE) would be a no-op. The source observation's q1 answer (work/notes/observations/triage-cas-race-test-still-flakes-under-parallel-load.md) explicitly picked option (a) mirroring serialise-review-gate-test-under-parallel-load.

_Suggested default: Cancel the task as already-delivered: 'test/advance-triage.test.ts' + 'test/triage-persist.test.ts' are already in RACE_SENSITIVE with fileParallelism:false, which is exactly option (a). Verify the flake is actually gone (run the full suite repeatedly), then move the task to tasks/cancelled/ with reason 'superseded — the serialise-the-test fix already landed via cas-create-nonce-authoritative-same-identity' and discharge the source observation._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**If residual work DOES remain (the flake still fires even though the tests run serialised), what is the actual remaining scope? The original observation says PR #90's contention-model fix did not eliminate the flake, and option (a) is now also already in place. So is the real residual concern that the flake survives EVEN serialised, and if so should we pursue option (b) (tighten the injected-contention model so the loser's lease is provably stale) instead?**

> The source observation title states the test 'STILL flakes 2 winners under full-suite parallel load (despite PR #90's deterministic-contention fix)'. PR #90 (triage-cas-race-test-models-real-contention, DONE) took the tighten-the-contention-model path (option b). Now option (a) serialisation is ALSO in place. If a 2-winners flake can still occur, neither serialisation nor the prior contention model fully closed it, which would weaken the 'pure test-harness, product CAS sound' diagnosis and could point at the create-CAS path (src/advancing-lock.ts createAttempt fetch/check-then-act window) the observation flagged. The test still asserts won/lost.toHaveLength(1) under Promise.all (test/advance-triage.test.ts:480,500-501).

_Suggested default: Treat 'still flakes even serialised' as unproven until reproduced: do NOT pre-commit to option (b) or to touching product code. First reproduce under the current (already-serialised) config; only if a 2-winners failure recurs, open a fresh, properly-scoped slice (instrument applyTransition/createAttempt, decide b vs a deeper fix) rather than building this stub. If it cannot be reproduced, this confirms cancelling per the question above._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**This task is needsAnswers:true but its body is a bare promotion stub: it has only a 'What to build' pointer back to the observation, with NO self-contained '## What to build' / '## Acceptance criteria' / '## Prompt' sections and NO '## Open questions' block. Before it can be built, what should its concrete acceptance bar and scope fence be?**

> work/tasks/ready/triage-cas-race-test-still-flakes-under-parallel-load.md contains only: 'Promoted from observation ... A human answered "promote" ... Carries needsAnswers:true so the advance loop surfaces the open scoping questions before it is built.' WORK-CONTRACT requires a task's Prompt to be self-contained (an agent could start from the file alone) with checkbox acceptance criteria; a needsAnswers:true item must list its open questions in the body. Neither is present, so the task is not claim-ready (REVIEW-PROTOCOL lens 3, contract conformance). The sibling done slice serialise-review-gate-test-under-parallel-load is a clean template for how such a task should read.

_Suggested default: Only author a full self-contained body (scope: TEST-only, no src/** changes; acceptance: ≥5 consecutive green full-suite runs with no '2 winners', the exactly-one-winner/one-loser invariant still genuinely asserted via the real CAS) IF the answers above establish that real residual work exists. If the task is cancelled as already-delivered, this question is moot._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
