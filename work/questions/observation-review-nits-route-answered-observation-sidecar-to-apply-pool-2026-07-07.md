<!-- dorfl-sidecar: item=observation:review-nits-route-answered-observation-sidecar-to-apply-pool-2026-07-07 type=observation slug=review-nits-route-answered-observation-sidecar-to-apply-pool-2026-07-07 allAnswered=false -->

## Q1

**What should become of these three non-blocking review nits from the Gate-2 approval of route-answered-observation-sidecar-to-apply-pool — promote to a follow-up task, fold individually into the source task's record, or drop?**

> Sidecar carries 3 nits against the DONE task work/tasks/done/route-answered-observation-sidecar-to-apply-pool.md: (a) missing '## Decisions' block ratifying 'answered sidecar wins over triaged: marker' (task prompt explicitly asked this be recorded; encoded by test 'an ANSWERED sidecar wins even when the observation is ALSO triaged:' in lifecycle-pools.test.ts); (b) acceptance criterion (c) — end-to-end apply of a fully-answered observation produces the decided artifact and removes source+sidecar — has no NEW test in the diff (only classifier + mirror-gather parity added); (c) silent behaviour change: SETTLED (triaged:) observation with PENDING sidecar now falls through and is enumerated in neither pool, guarded only by a trailing comment in lifecycle-pools.ts. All three are code-level, actionable, and small; (a) is a documentation/ratification of an in-scope decision the task prompt explicitly demanded, and (b) closes an acceptance-criterion gap.

_Suggested default: Promote to one small follow-up task bundling all three (record the Decision, add the E2E answered-observation apply test, and convert the trailing comment into a one-line dropped-item assertion) — the task is DONE so its file should not be re-edited, and the three nits are cohesive enough for one task rather than three._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Promote one small follow-up task bundling all three nits: (a) record the "answered sidecar wins over triaged: marker" decision (already encoded by a test), (b) add the missing end-to-end test, apply a fully-answered observation and assert the decided artifact is produced AND the source+sidecar removed (acceptance criterion (c) had no new test), and (c) convert the trailing "settled + pending sidecar falls through to neither pool" comment into a real one-line dropped-item assertion. The task is done so don't re-edit its file; the three nits are cohesive. NOTE: this is a real follow-up to MY fix, worth doing since (b) closes a genuine acceptance-criterion gap and (c) guards the silent-fall-through. Then delete this observation.
