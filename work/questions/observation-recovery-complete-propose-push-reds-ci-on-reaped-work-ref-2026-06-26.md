<!-- dorfl-sidecar: item=observation:recovery-complete-propose-push-reds-ci-on-reaped-work-ref-2026-06-26 type=observation slug=recovery-complete-propose-push-reds-ci-on-reaped-work-ref-2026-06-26 allAnswered=false -->

## Q1

**What becomes of this observation — keep it open as the durable evidence home until task `propose-push-survives-stale-lease-on-reaped-work-ref` lands and then mark it RESOLVED, or discharge it now (delete / fold into the task) because the task already exists in `work/tasks/ready/` and fully owns the fix?**

> The note explicitly self-disposes: 'This is the exact defect the ready task propose-push-survives-stale-lease-on-reaped-work-ref fixes … This note is the durable home for the recurrence evidence so the pattern is on the record for triage; mark RESOLVED when that task lands.' The related task DOES exist at work/tasks/ready/propose-push-survives-stale-lease-on-reaped-work-ref.md (sub-case 2: gone ref + work provably ancestor-of-<arbiter>/main = benign already-landed success, with recovery-complete pinned as the dominant trigger). Five concrete CI failures are recorded as evidence (ci-template-parallel-merge-fanout, test-cross-job-concurrent-land run 28237264255, sidecar-kind-field, protocol-land-time-reverify-invariant, merge-questions-gate-axis). So the residual judgement is purely whether the evidence-archive value of keeping the note open justifies the open-observation overhead, or whether the task itself is now a sufficient home.

_Suggested default: Keep the observation open as the recurrence-evidence record exactly as the note prescribes, and resolve it the moment `propose-push-survives-stale-lease-on-reaped-work-ref` lands on main (no new task/PRD/ADR needed — the fix is already tasked)._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Keep the observation open as the recurrence-evidence record, exactly as the note prescribes. Resolve it (delete) the moment `propose-push-survives-stale-lease-on-reaped-work-ref` lands on main. No new task/PRD/ADR needed: the fix is already tasked and owns it.

## Q2

**The human's answer says to keep this observation open as the durable recurrence-evidence record until `propose-push-survives-stale-lease-on-reaped-work-ref` lands on main, then delete it — none of the available outcomes (task/prd/adr/delete/ask) express "keep open, unchanged, pending an external trigger." How should I encode that? Options: (a) leave the frontmatter as-is but flip `needsAnswers: true` → `needsAnswers: false` (answers are recorded, no further human input needed, item stays open as evidence) — pick this if you want the observation to simply stop pinging the questions gate; (b) treat the answer as a directive to `delete` NOW because the task already owns the fix and git history preserves the evidence; (c) mint a tiny follow-up `task` whose sole job is "delete this observation once `propose-push-survives-stale-lease-on-reaped-work-ref` is on main" so the cleanup is tracked. My read of the answer is (a) — keep it open, just clear the needs-answers flag — but I want to confirm before emitting, because the engine's discharge outcomes don't natively cover "answered but intentionally left open."**

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
