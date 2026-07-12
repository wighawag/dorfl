<!-- dorfl-sidecar: item=observation:rename-spec-4b-namespace-consumer-clause-noop-2026-07-10 type=observation slug=rename-spec-4b-namespace-consumer-clause-noop-2026-07-10 allAnswered=false -->

Item: [`observation:rename-spec-4b-namespace-consumer-clause-noop-2026-07-10`](../notes/observations/rename-spec-4b-namespace-consumer-clause-noop-2026-07-10.md)

## Q1

**What becomes of this observation — discard it as a recorded decision (the task is already done and the drift is small), or extract a durable lesson from it (e.g. a to-task convention that acceptance clauses referencing specific files must be grounded against the code)?**

> Observation records that acceptance clause 4b of the already-done task rename-spec-remaining-src-modules-b asserted a 'namespace === spec' consumer switch in close-job.ts and lifecycle-gather.ts, but neither file has such a comparison (close-job.ts uses a via axis; lifecycle-gather.ts only EMITS namespace: 'spec' into sidecar keys — flipping those emitters would be non-additive and break the sidecar read path until data migration). Verified against current tree: grep of packages/dorfl/src/{close-job,lifecycle-gather}.ts shows only namespace EMITS and no === 'spec' comparison; the real consumer comparisons live in do.ts/advance*.ts/scan.ts/cli.ts/etc., which the task's own scope boundary lists OUT of scope. Task sits in work/tasks/done/ and its gate was green. Signal is factual, self-contained, and the PROCEED decision is already justified in the note.

_Suggested default: Discard: the observation captures a done-time PROCEED decision on a small factual gap that is fully explained and already resolved; no follow-up task is needed unless the tasking-hygiene lesson is worth generalising._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Discard. This is a done-time PROCEED decision on a small factual gap (an acceptance clause that named a consumer switch which those files did not actually contain), fully explained and already resolved by the landed task rename-spec-remaining-src-modules-b. The generalisable tasking-hygiene lesson (ground acceptance clauses that reference specific files against the code) is already captured by the consolidated review-lens task; no separate follow-up is needed here.
