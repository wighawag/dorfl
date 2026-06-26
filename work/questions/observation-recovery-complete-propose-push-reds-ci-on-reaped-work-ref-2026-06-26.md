<!-- dorfl-sidecar: item=observation:recovery-complete-propose-push-reds-ci-on-reaped-work-ref-2026-06-26 type=observation slug=recovery-complete-propose-push-reds-ci-on-reaped-work-ref-2026-06-26 allAnswered=false -->

## Q1

**What becomes of this observation — keep it open as the durable evidence home until task `propose-push-survives-stale-lease-on-reaped-work-ref` lands and then mark it RESOLVED, or discharge it now (delete / fold into the task) because the task already exists in `work/tasks/ready/` and fully owns the fix?**

> The note explicitly self-disposes: 'This is the exact defect the ready task propose-push-survives-stale-lease-on-reaped-work-ref fixes … This note is the durable home for the recurrence evidence so the pattern is on the record for triage; mark RESOLVED when that task lands.' The related task DOES exist at work/tasks/ready/propose-push-survives-stale-lease-on-reaped-work-ref.md (sub-case 2: gone ref + work provably ancestor-of-<arbiter>/main = benign already-landed success, with recovery-complete pinned as the dominant trigger). Five concrete CI failures are recorded as evidence (ci-template-parallel-merge-fanout, test-cross-job-concurrent-land run 28237264255, sidecar-kind-field, protocol-land-time-reverify-invariant, merge-questions-gate-axis). So the residual judgement is purely whether the evidence-archive value of keeping the note open justifies the open-observation overhead, or whether the task itself is now a sufficient home.

_Suggested default: Keep the observation open as the recurrence-evidence record exactly as the note prescribes, and resolve it the moment `propose-push-survives-stale-lease-on-reaped-work-ref` lands on main (no new task/PRD/ADR needed — the fix is already tasked)._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
