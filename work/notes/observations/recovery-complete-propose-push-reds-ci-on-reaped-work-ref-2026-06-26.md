---
title: recovery-complete propose push reds CI with 'stale info' on an already-landed + reaped work ref
date: 2026-06-26
status: open
relatedTask: propose-push-survives-stale-lease-on-reaped-work-ref
needsAnswers: true
---

## What was observed

Five separate `dorfl advance "task:<slug>" --propose --watch` CI runs failed
exit 1 with the SAME push rejection, all via the recovery-complete flow:

```
>> recovered a stranded already-complete branch for '<slug>' — integrating the kept commit (no rebuild). This signals an earlier un-merged PR.
>> Recovering '<slug>': rebasing the kept work/task-<slug> onto origin/main…
error: git push origin work/task-<slug>:work/task-<slug> --force-with-lease=work/task-<slug> failed (exit 1):
 ! [rejected]          work/task-<slug> -> work/task-<slug> (stale info)
```

Affected slugs (all confirmed BENIGN race tails: the done body is on
`origin/main` AND the `work/task-<slug>` ref is GONE/reaped, so the work fully
landed and nothing was lost):

- `ci-template-parallel-merge-fanout` (first observed; first-pass propose leg)
- `test-cross-job-concurrent-land` (run 28237264255; recovery-complete)
- `sidecar-kind-field` (recovery-complete)
- `protocol-land-time-reverify-invariant` (recovery-complete)
- `merge-questions-gate-axis` (recovery-complete)

## Why it happens

The recovery-complete flow (`complete.ts` committed-recovery →
`integration-core.ts` rebases the kept branch onto `<arbiter>/main`, REWRITING
the tip) then reconciles via the propose integrator push (`integrator.ts`
~L392): a BARE `--force-with-lease=<branch>` through the THROWING `pushBranch`
helper. That push has NO stale-lease survival (unlike the continue-path pushes,
which thread an explicit `<branch>:<expectedTip>` lease and survive `stale
info` via `pushContinuedBranchWithStaleLeaseRetry`). When the work has already
landed on an earlier PR and the ref was reaped, the bare lease is stale, git
rejects, and the run reds the whole CI job for work that is already on `main`.

The recovery note literally says "this signals an earlier un-merged PR", so the
ref-is-gone-because-already-landed case is the NORMAL recovery outcome, not an
edge case. A benign already-landed recovery should be a clean no-op success,
not a red CI leg.

## Disposition

This is the exact defect the ready task
`propose-push-survives-stale-lease-on-reaped-work-ref` fixes (its sub-case 2:
gone ref + work provably ancestor-of-`<arbiter>/main` = benign already-landed
success; recovery-complete pinned there as the dominant trigger). This note is
the durable home for the recurrence evidence so the pattern is on the record
for triage; mark RESOLVED when that task lands.

## Applied answers 2026-07-07

### q1: What becomes of this observation — keep it open as the durable evidence home until task `propose-push-survives-stale-lease-on-reaped-work-ref` lands and then mark it RESOLVED, or discharge it now (delete / fold into the task) because the task already exists in `work/tasks/ready/` and fully owns the fix?

Keep the observation open as the recurrence-evidence record, exactly as the note prescribes. Resolve it (delete) the moment `propose-push-survives-stale-lease-on-reaped-work-ref` lands on main. No new task/PRD/ADR needed: the fix is already tasked and owns it.

## Applied answers 2026-07-07

### q1: What becomes of this observation — keep it open as the durable evidence home until task `propose-push-survives-stale-lease-on-reaped-work-ref` lands and then mark it RESOLVED, or discharge it now (delete / fold into the task) because the task already exists in `work/tasks/ready/` and fully owns the fix?

Keep open as the recurrence-evidence record until `propose-push-survives-stale-lease-on-reaped-work-ref` lands on main, then delete. The fix is already tasked and owns it; this note is just the durable evidence archive. No new task/prd/adr.

Keep the observation open as the recurrence-evidence record, exactly as the note prescribes. Resolve it (delete) the moment `propose-push-survives-stale-lease-on-reaped-work-ref` lands on main. No new task/PRD/ADR needed: the fix is already tasked and owns it.

### q2: The human's answer says to keep this observation open as the durable recurrence-evidence record until `propose-push-survives-stale-lease-on-reaped-work-ref` lands on main, then delete it — none of the available outcomes (task/prd/adr/delete/ask) express "keep open, unchanged, pending an external trigger." How should I encode that? Options: (a) leave the frontmatter as-is but flip `needsAnswers: true` → `needsAnswers: false` (answers are recorded, no further human input needed, item stays open as evidence) — pick this if you want the observation to simply stop pinging the questions gate; (b) treat the answer as a directive to `delete` NOW because the task already owns the fix and git history preserves the evidence; (c) mint a tiny follow-up `task` whose sole job is "delete this observation once `propose-push-survives-stale-lease-on-reaped-work-ref` is on main" so the cleanup is tracked. My read of the answer is (a) — keep it open, just clear the needs-answers flag — but I want to confirm before emitting, because the engine's discharge outcomes don't natively cover "answered but intentionally left open."

Option (a): leave the frontmatter/body as-is but flip `needsAnswers: true` -> `false`. The answer is recorded and no further human input is needed; the observation stays on record as passive evidence and stops pinging the questions gate. Do NOT delete now (the evidence value is the whole point) and do NOT mint a cleanup task (over-engineering, the eventual delete is a trivial manual/next-triage step when the fix lands). Meta-note for the engine: this exposes a real gap, there is no first-class KEEP outcome in {task,prd,adr,delete,ask} for "answered, no action, retain the note." For now, KEEP = clear needsAnswers + retain the file. That gap is itself worth an observation/task if it recurs (it will).
