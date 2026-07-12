<!-- dorfl-sidecar: item=observation:reap-squash-helper-scope-2026-07-10 type=observation slug=reap-squash-helper-scope-2026-07-10 allAnswered=false -->

Item: [`observation:reap-squash-helper-scope-2026-07-10`](../notes/observations/reap-squash-helper-scope-2026-07-10.md)

## Q1

**What should become of this observation now that the scope-narrowing decision it records has been ratified and the rationale has been made durable at the choice sites (JSDoc in integration-core.ts and isolation.ts) and in the done task's Decisions block?**

> The note captures WHY isProvablyMergedForReap was wired at only 4 of the 6 files named in the task Acceptance (the other 2 are pure-ancestry, not reap-safety). Gate 2 approved with a non-blocking nit asking for ratification; the companion review-nits observation is marked status: resolved (2026-07-11). Task lives at work/tasks/done/reap-squash-merged-remote-work-branches.md. The rationale now also lives inline as JSDoc at the two contested sites, so the observation is no longer the sole home of the decision. Candidate outcomes: (a) keep as-is as historical rationale, (b) promote to an ADR codifying 'reap-safety vs pure-ancestry ancestry-check taxonomy', (c) delete since the JSDoc + done-task Decisions block already carry the durable form.

_Suggested default: Keep as historical rationale (no action) — the decision is now durable at the choice sites and in the done task; the observation is a dated audit trail, not load-bearing._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
