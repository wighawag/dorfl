<!-- dorfl-sidecar: item=observation:review-nits-propose-push-survives-stale-lease-on-reaped-work-ref-2026-06-26 type=observation slug=review-nits-propose-push-survives-stale-lease-on-reaped-work-ref-2026-06-26 allAnswered=false -->

## Q1

**What becomes of this observation — promote to task(s), keep as durable log, or delete?**

> Gate-2 non-blocking nits from 'propose-push-survives-stale-lease-on-reaped-work-ref' (still open, dated 2026-06-26): (1) no '## Decisions' block on the done task / commit bdbf71ec even though the task prompt required one; (2) complete.ts ~L1095-1110 still calls formatProposeNextStep with requestOpened and ignores integrator.ts's new alreadyLanded flag + custom instruction (L425-435), so 'dorfl complete --propose' hitting the benign already-landed race tail misreports a push+PR step that did not happen — residual UX bug on a sibling caller (CI-dominant path via performIntegration is unaffected); (3) coherence: pushProposeBranchWithStaleLeaseRetry now lives in continue-branch.ts alongside pushContinuedBranchWithStaleLeaseRetry, so the file name no longer matches its contents — consider rename/split or a top-of-file scope note. Verified current tree still shows the UX misreport at complete.ts L1095-1110 and the co-located helpers in continue-branch.ts.

_Suggested default: Promote nit #2 (complete.ts should honour alreadyLanded and emit the integrator.instruction instead of the push+PR next-step) to a small task; fold nit #3 (rename/split or scope-note continue-branch.ts) into that same task as a coherence touch-up; treat nit #1 (missing Decisions block) as a one-off retrospective log — no new task, delete after acknowledgement._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Promote a small task for nit #2 (complete.ts should honour integrator.ts's `alreadyLanded` flag and emit the custom instruction instead of the push+PR next-step, so `dorfl complete --propose` hitting the benign already-landed race tail stops misreporting a step that didn't happen). Fold nit #3 (rename/split or add a scope note to continue-branch.ts, which now also holds the propose-branch stale-lease helper) into that same task as a coherence touch-up. Nit #1 (missing Decisions block) is the standing systemic pattern, don't duplicate. Then delete this observation.
