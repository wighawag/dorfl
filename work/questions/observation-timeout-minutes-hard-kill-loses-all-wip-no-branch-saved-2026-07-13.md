<!-- dorfl-sidecar: item=observation:timeout-minutes-hard-kill-loses-all-wip-no-branch-saved-2026-07-13 type=observation slug=timeout-minutes-hard-kill-loses-all-wip-no-branch-saved-2026-07-13 allAnswered=false -->

Item: [`observation:timeout-minutes-hard-kill-loses-all-wip-no-branch-saved-2026-07-13`](../notes/observations/timeout-minutes-hard-kill-loses-all-wip-no-branch-saved-2026-07-13.md)

## Q1

**Which of the three tension-options should be adopted for the over-cap-task-loses-WIP trap: (1) tasking-discipline only (task acceptance must fit under legTimeoutMinutes), (2) also add a graceful pre-timeout checkpoint (self-imposed sub-cap that saves WIP to work/<slug> and pushes before the SIGKILL), or (3) a full continue-token / resumable-task protocol?**

> The observation body lays out the three options in '## The tension / options' and explicitly flags it as needing a human decision. Author recommendation: ship (1) NOW as cheap tasking discipline, consider (2) as the durable fix so genuinely-long work is incrementally resumable, (3) only if a real need appears.

_Suggested default: (1) now as tasking discipline + queue (2) as a follow-up task for the durable fix; skip (3) until a concrete need appears._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**If option (1) is adopted, where should the 'a task's acceptance must be achievable within legTimeoutMinutes' rule be recorded — in WORK-CONTRACT.md, in the task template, in to-task's checks, or several of these?**

> The observation says option (1) 'Document this in the tasking protocol' but does not name the exact doc. The tasking judgement source is to-task + WORK-CONTRACT; the template is the author-facing surface.

_Suggested default: State the rule in WORK-CONTRACT.md and have to-task enforce it as a review lens; the template gets a one-line reminder._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
