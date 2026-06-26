<!-- dorfl-sidecar: item=observation:review-nits-test-in-process-concurrent-land-2026-06-26 type=observation slug=review-nits-test-in-process-concurrent-land-2026-06-26 allAnswered=false -->

## Q1

**What becomes of this observation — the three non-blocking Gate-2 nits on the now-landed 'test-in-process-concurrent-land' task: promote any/all to follow-up tasks, fold into an ADR/Decisions note, keep as a durable observation, or delete?**

> Observation at work/notes/observations/review-nits-test-in-process-concurrent-land-2026-06-26.md records three non-blocking nits from the APPROVED Gate-2 review of test-in-process-concurrent-land (now under work/tasks/done/test-in-process-concurrent-land.md):
>   1. The test narrows the task's allowed disposition (loser must also land claimed-done; asserts result.claimedAndDone === 2 and every item.status === 'claimed-done') — an unrecorded design tightening, no Decisions block in PR/task body.
>   2. The final 'verify never lands a broken tree on main' check shells `sh -c 'exit 0'` against the post-land tip — trivially green; signal-poor. Consider a non-trivial verify (content/marker) or drop the re-run.
>   3. Per-item lock post-land guard only asserts `lock.state !== 'stuck'` when defined; doesn't check the lock `reason` string for lock/contention language. Optional hardening.
> The task has landed and the gate approved, so these are durable triage residue, not blockers.

_Suggested default: Promote nit #1 (record the disjoint-green tightening as a Decisions/ADR note on the task or a small ADR) and nit #2 (replace the trivial `sh -c 'exit 0'` re-verify with a content/marker assertion, or drop it) into one small follow-up task; keep nit #3 as an optional hardening line in that task or drop it; then delete this observation._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
