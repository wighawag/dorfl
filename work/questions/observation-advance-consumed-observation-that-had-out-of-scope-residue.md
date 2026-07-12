<!-- dorfl-sidecar: item=observation:advance-consumed-observation-that-had-out-of-scope-residue type=observation slug=advance-consumed-observation-that-had-out-of-scope-residue allAnswered=false -->

Item: [`observation:advance-consumed-observation-that-had-out-of-scope-residue`](../notes/observations/advance-consumed-observation-that-had-out-of-scope-residue.md)

## Q1

**What should become of this observation? Reply with a disposition and a reason: resolve (settle it, keep the note on record — say why), promote (mint a task / spec / adr — say which and why), delete (redundant or obsolete — say why), or duplicate (maps onto an existing item — name it).**

> The engine records your disposition from the answer (no token needed); an answered promote mints the artifact, resolve keeps the note settled, delete/duplicate discharge it.

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**When advance scaffolds a task from an observation whose residue is only PARTIALLY in-scope for that task, should the workflow (a) leave the observation in place until all residue is consumed, or (b) auto-migrate the un-consumed residue into a fresh observation/spec, or (c) require the human to answer per-consumption which residue points are discharged?**

> The observation body itself poses this as the open design question (options a/b), citing commit 9cb42807 which deleted rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset.md even though only point 3 of its STILL-LIVE list was in scope for the scaffolded task; points 1-2 were explicitly out-of-scope in the task and would have been silently lost. The reporter manually restored the observation with point 3 marked RESOLVED-BY and points 1-2 preserved.

_Suggested default: (b) migrate un-consumed residue into a fresh observation on consumption, so no live signal is silently lost and the source item still cleanly retires._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Is advance's current consume-on-scaffold behaviour (delete the source observation once a task is minted from it) still the right default given this partial-residue failure mode, or should consumption become conditional on the task covering the WHOLE residue?**

> The incident shows the current all-or-nothing delete assumes an observation maps 1:1 to the task it scaffolds. A task's Out-of-scope section is machine-visible evidence that residue survives; advance could refuse to delete when out-of-scope items reference the source observation's live points.

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
