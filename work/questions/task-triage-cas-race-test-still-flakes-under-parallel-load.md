<!-- dorfl-sidecar: item=task:triage-cas-race-test-still-flakes-under-parallel-load type=task slug=triage-cas-race-test-still-flakes-under-parallel-load allAnswered=false -->

## Q1

**Serialisation granularity: should this slice serialise the WHOLE file `packages/dorfl/test/advance-triage.test.ts` by adding it to the `RACE_SENSITIVE` array in `packages/dorfl/vitest.config.ts` (the sibling-slice pattern), or serialise ONLY the racing block by wrapping just `describe('advance — answered triage dispositions flow through the apply path', …)` (or the single `it('a same-slug new-item race …')` test) with `describe.sequential` / `.concurrent(false)` inside the file?**

> The observation's recommendation listed option (a) as 'serialising this specific test (`describe.sequential` / run it outside the parallel pool)' — those are TWO different mechanisms with different blast radius. The applied answer (`work/notes/observations/triage-cas-race-test-still-flakes-under-parallel-load.md` §'Applied answers') picked option (a) and pointed at the sibling slice `serialise-review-gate-test-under-parallel-load` (which did FILE-LEVEL via `RACE_SENSITIVE`) — but `advance-triage.test.ts` has 11 tests and only ONE is the racing one (`grep -n describe` shows three `describe` blocks, the race lives in the third), so file-level pulls 10 fast pure-logic tests off the parallel pool too. The sibling test (`review-gate.test.ts`) didn't have that asymmetry. The task body is currently a stub ('draft this into a buildable task') so this granularity choice is unresolved on disk.

_Suggested default: Mirror the sibling precedent exactly: file-level via `RACE_SENSITIVE` (the simplest, already-proven shape; the 10 collateral tests are cheap and per-file serialisation is what the bucket exists for). Only drop to `describe.sequential` if a measured suite-time regression justifies the extra surface area._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Doc-comment update scope: the sibling slice already generalised the `RACE_SENSITIVE` doc-comment to 'tests that flake under file-parallel load' (covering CAS races AND spawn-stdin races). This new entry is a CAS-race case — does it need any further widening of the bucket comment, or only a per-entry one-line note next to the new `'test/advance-triage.test.ts'` line pointing at the observation (mirroring how `review-gate.test.ts` got a one-liner)?**

> Per `packages/dorfl/vitest.config.ts` lines 15-26 the bucket-level comment already enumerates '(1) `file://` CAS races' and '(2) spawn-stdin races' — case (1) already covers this slice's flake (the advance-triage race is the SAME class as the existing `claim-cas`/`tasking-lock`/`advancing-lock` entries). So no bucket-wide widening seems needed; only a per-entry note. Confirming so the task doesn't accidentally rewrite the bucket comment a third time.

_Suggested default: Per-entry one-line note ONLY (one line of `//` above the new array entry, pointing at the observation `triage-cas-race-test-still-flakes-under-parallel-load` and referencing PR #90 as the prior in-test fix that this serialisation supersedes). Do NOT re-touch the bucket-level comment._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Should this slice also remove or simplify the PR-#90 in-test deterministic-contention machinery (the injected-contention seams that PR #90 added inside the race test) now that the test is being serialised at the runner level — or leave PR #90's seams in place as a belt-and-braces second line of defence?**

> PR #90 (`tasks/done/triage-cas-race-test-models-real-contention.md`) added in-test contention modelling to make the race deterministic; the observation reports that fix REDUCED but did not eliminate the flake. Serialising the file removes the parallel pressure entirely, which arguably makes PR #90's in-test seams redundant. Leaving them in is harmless code; removing them shrinks the test and removes a now-unmotivated abstraction. The applied answer did not address PR #90's residue. The task body is a stub so this scope question is open.

_Suggested default: Leave PR #90's seams in place untouched and KEEP this slice surgical (vitest.config.ts only). Reason: the seams document a real CAS-correctness assertion shape (distinct vs identical committer identity, per-attempt nonce) that has independent value as a regression test even after serialisation; removing them is a separate cleanup slice if anyone wants it._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
