---
title: 'A bounced job reports the harness STARTUP WARNING as the reason it failed, so an OOM kill is filed as a model-resolution error'
date: 2026-09-20
status: open
severity: medium
needsAnswers: true
---

When a `dorfl do` build agent dies, the reason recorded can be a line the harness printed at STARTUP that has nothing to do with why it died. The wrong reason is then committed to `main` and pasted into the item's `work/questions/` sidecar, so a phantom diagnosis becomes the durable record of why the item is blocked.

Observed twice in a row on one task, in `wighawag/etherfold`, while a conductor was driving `drive-tasks`.

## What was recorded, and what actually happened

Both runs recorded, in the log, in the surface commit on `main`, and in the question opened against the task:

```
agent failed: Warning: No models match pattern "ollama/glm-4.7:cloud"
```

That is a `pi` startup warning about an unrelated model pattern in the harness configuration. It is printed on runs that go on to succeed, and it was not the failure. The failure, from the same jobs' systemd journals:

```
dorfl-t4.service: The kernel OOM killer killed some processes in this unit.
dorfl-t4.service: Failed with result 'oom-kill'.
dorfl-t4.service: Consumed 10min 18s CPU over 18min 49s wall, 55.9G memory peak.

dorfl-t5.service: The kernel OOM killer killed some processes in this unit.
dorfl-t5.service: Consumed 6min 27s CPU over 9min 3s wall, 57.4G memory peak.
```

The build agent was killed by the kernel at ~56 GB on a 60 GB machine, mid-build, both times. The cause was a memory-hungry negative-control test the agent had written; that half is the target repo's problem and was fixed there. **The runner's half is that it could not say so.**

The apparent mechanism is that the agent's stderr is scanned and the FIRST line, or the first line matching a warning/error shape, is surfaced. A harness that greets you with a warning therefore overwrites every subsequent diagnosis with its greeting.

## Why it is worth more than a shrug

**It names a subsystem that is not involved.** A reader, human or agent, sees a model-resolution failure and goes to check harness configuration, model availability and provider auth. None of that was wrong. The actual answer -- the box ran out of memory -- is in a place the message gives no reason to look.

**It travels, and it outlives the run.** The reason is not merely logged. It becomes the subject line of the surface commit on `main`, and it is pasted verbatim into the body of the `work/questions/` sidecar as the question a human or the next agent must answer. So the phantom is what the re-dispatched agent reads as its handoff.

**It converts a retryable event into an apparent judgement call.** An OOM kill is a capacity problem: requeue and re-dispatch, ideally under a cap. A model that cannot be resolved looks like broken configuration a human must fix. The runner gated the task with `needsAnswers: true` on the strength of the wrong one, twice, and a human had to answer the sidecar by hand both times to unblock a task that had nothing wrong with it.

## What would fix it

**Prefer the process's exit CONDITION over any of its output.** A process killed by a signal is describable without reading stderr at all: the wait status says so, and `WIFSIGNALED` / signal 9 plus a near-limit peak RSS is an OOM to within a useful margin. A reason derived from the exit condition would have been right both times with no parsing of harness chatter. Where the job runs under a systemd unit, `Failed with result 'oom-kill'` is one `systemctl show` away and is authoritative.

**Prefer the LAST stderr output over the first** when output must be used at all. The final lines are where a dying process says why; the first lines are where a harness says hello.

**Failing both, suppress known-benign harness startup lines.** This would have caught this exact one, but it only moves the boundary rather than removing the class, so it is the weakest of the three.

A related, cheaper improvement: when the recorded reason is an infrastructure event rather than a work judgement, opening a `needsAnswers` question is the wrong response, because there is no decision for a human to make. A retryable-class bounce could requeue rather than gate.

## Provenance

Moved here from `wighawag/etherfold`'s observations bucket on 2026-09-20, where it was filed during the drive that hit it. It is a defect in this tool, not in that repo, so it is recorded against the tool.
