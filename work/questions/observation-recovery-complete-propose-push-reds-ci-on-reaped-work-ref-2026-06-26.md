<!-- dorfl-sidecar: item=observation:recovery-complete-propose-push-reds-ci-on-reaped-work-ref-2026-06-26 type=observation slug=recovery-complete-propose-push-reds-ci-on-reaped-work-ref-2026-06-26 allAnswered=false -->

## Q1

**What becomes of this observation — keep it open as the durable evidence home until task `propose-push-survives-stale-lease-on-reaped-work-ref` lands and then mark it RESOLVED, or discharge it now (delete / fold into the task) because the task already exists in `work/tasks/ready/` and fully owns the fix?**

> The note explicitly self-disposes: 'This is the exact defect the ready task propose-push-survives-stale-lease-on-reaped-work-ref fixes … This note is the durable home for the recurrence evidence so the pattern is on the record for triage; mark RESOLVED when that task lands.' The related task DOES exist at work/tasks/ready/propose-push-survives-stale-lease-on-reaped-work-ref.md (sub-case 2: gone ref + work provably ancestor-of-<arbiter>/main = benign already-landed success, with recovery-complete pinned as the dominant trigger). Five concrete CI failures are recorded as evidence (ci-template-parallel-merge-fanout, test-cross-job-concurrent-land run 28237264255, sidecar-kind-field, protocol-land-time-reverify-invariant, merge-questions-gate-axis). So the residual judgement is purely whether the evidence-archive value of keeping the note open justifies the open-observation overhead, or whether the task itself is now a sufficient home.

_Suggested default: Keep the observation open as the recurrence-evidence record exactly as the note prescribes, and resolve it the moment `propose-push-survives-stale-lease-on-reaped-work-ref` lands on main (no new task/SPEC/ADR needed — the fix is already tasked)._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Keep open as the recurrence-evidence record until `propose-push-survives-stale-lease-on-reaped-work-ref` lands on main, then delete. The fix is already tasked and owns it; this note is just the durable evidence archive. No new task/spec/adr.

Keep the observation open as the recurrence-evidence record, exactly as the note prescribes. Resolve it (delete) the moment `propose-push-survives-stale-lease-on-reaped-work-ref` lands on main. No new task/SPEC/ADR needed: the fix is already tasked and owns it.

## Q2

**The human's answer says to keep this observation open as the durable recurrence-evidence record until `propose-push-survives-stale-lease-on-reaped-work-ref` lands on main, then delete it — none of the available outcomes (task/spec/adr/delete/ask) express "keep open, unchanged, pending an external trigger." How should I encode that? Options: (a) leave the frontmatter as-is but flip `needsAnswers: true` → `needsAnswers: false` (answers are recorded, no further human input needed, item stays open as evidence) — pick this if you want the observation to simply stop pinging the questions gate; (b) treat the answer as a directive to `delete` NOW because the task already owns the fix and git history preserves the evidence; (c) mint a tiny follow-up `task` whose sole job is "delete this observation once `propose-push-survives-stale-lease-on-reaped-work-ref` is on main" so the cleanup is tracked. My read of the answer is (a) — keep it open, just clear the needs-answers flag — but I want to confirm before emitting, because the engine's discharge outcomes don't natively cover "answered but intentionally left open."**

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Option (a): leave the frontmatter/body as-is but flip `needsAnswers: true` -> `false`. The answer is recorded and no further human input is needed; the observation stays on record as passive evidence and stops pinging the questions gate. Do NOT delete now (the evidence value is the whole point) and do NOT mint a cleanup task (over-engineering, the eventual delete is a trivial manual/next-triage step when the fix lands). Meta-note for the engine: this exposes a real gap, there is no first-class KEEP outcome in {task,spec,adr,delete,ask} for "answered, no action, retain the note." For now, KEEP = clear needsAnswers + retain the file. That gap is itself worth an observation/task if it recurs (it will).

## Q3

**The engine's discharge outcomes are {task, spec, adr, delete, ask} — none natively express the human's directive of 'keep this observation open, unchanged, as passive evidence, just stop pinging the questions gate until the fix lands.' My read is that the correct encoding is to leave the file body as-is and simply flip `needsAnswers: true` → `false` in the frontmatter, retaining the file. But that is not a first-class outcome I can emit. Please confirm one of: (a) Treat this as an out-of-band KEEP: the engine/human will manually clear `needsAnswers` and leave the file in place; I should emit `delete` with a reason of 'no-op: keep as evidence, needsAnswers to be cleared out-of-band' — NO, that would remove the evidence, which is the whole point, so this is wrong. (b) Emit `delete` NOW because git history preserves the evidence and the ready task `propose-push-survives-stale-lease-on-reaped-work-ref` fully owns the fix — the human explicitly rejected this ('Do NOT delete now, the evidence value is the whole point'). (c) Mint a tiny follow-up `task` whose sole job is 'delete this observation once propose-push-survives-stale-lease-on-reaped-work-ref lands on main' — the human explicitly rejected this as over-engineering. (d) There is a KEEP path I'm missing (e.g. the engine interprets a specific sentinel outcome, or `ask` with an empty question, or some other mechanism) that leaves the file intact and clears `needsAnswers`. If so, tell me the exact outcome string to emit. The human already flagged this as a real gap in the outcome set. I cannot honestly pick task/spec/adr/delete without contradicting the recorded answer, and re-emitting `ask` just loops. What outcome should I emit to encode 'answered, no action, retain the note, clear needsAnswers'?**

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Resolve via the EXISTING resolve-fully apply path (`applyAnsweredQuestions` path (3) in apply-persist.ts): harvest the answers into the body as a `## Applied answers` block, strip the open-questions block, clear `needsAnswers`, and delete the sidecar. This is invariant-clean (sidecar gone => `needsAnswers:false` is legal, no lie) and IS what "keep/resolve" means: the questions ARE answered, we just do not mint a task/spec/adr. No new KEEP state or frontmatter axis is needed. For THIS observation the harvested `## Applied answers` block already carries the verbatim "keep as evidence until `propose-push-survives-stale-lease-on-reaped-work-ref` lands, then delete" answer, so no separate `## Disposition` heading is needed. The genuine gap is only that the decision agent's verdict set {task,spec,adr,delete,ask} has no verdict routing to path (3) so it loops on `ask`; that is tracked SEPARATELY as a task to add a `resolve` verdict wired to the existing resolve-fully path.
