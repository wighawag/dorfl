---
title: 'advance workflow deleted an observation whose STILL-LIVE residue was explicitly out-of-scope for the task it scaffolded'
date: 2026-07-07
status: open
severity: low
needsAnswers: true
---

While building `default-requeue-succeeds-when-no-work-branch-exists`, noticed
that the "advance: create task" commit that scaffolded it (`9cb42807`) also
DELETED `work/notes/observations/rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset.md`.
That observation's STILL-LIVE list had three points; only point 3 was in scope
for the scaffolded task (the other two are called out as a SEPARATE design item
in the task's "Out of scope" section). Deleting the whole observation on
consumption erases the residue points 1-2 that were meant to keep signalling.

I restored the observation with point 3 marked RESOLVED-BY the task and points
1-2 preserved verbatim, so the signal survives. Worth checking whether the
advance workflow should either (a) leave the observation in place when a task
only addresses a subset of its residue, or (b) migrate the un-consumed residue
into a fresh observation/spec so no live signal is lost.
