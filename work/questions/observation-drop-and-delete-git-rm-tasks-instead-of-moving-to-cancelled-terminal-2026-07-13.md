<!-- dorfl-sidecar: item=observation:drop-and-delete-git-rm-tasks-instead-of-moving-to-cancelled-terminal-2026-07-13 type=observation slug=drop-and-delete-git-rm-tasks-instead-of-moving-to-cancelled-terminal-2026-07-13 allAnswered=false -->

Item: [`observation:drop-and-delete-git-rm-tasks-instead-of-moving-to-cancelled-terminal-2026-07-13`](../notes/observations/drop-and-delete-git-rm-tasks-instead-of-moving-to-cancelled-terminal-2026-07-13.md)

## Q1

**Should the standalone `drop <slug>` verb ALSO become regime-polymorphic (a task -> `git mv tasks/cancelled/`, retained), mirroring the apply `dispose` outcome the surface-stuck spec introduces? Or is human-invoked `drop` DEFINED as 'the direct hard-delete regardless of type' (in which case a SEPARATE `cancel <slug>` verb is the task-terminal move, and `drop` stays `git rm`)? I.e. is the gap 'drop should match dispose' or 'drop is fine, but there is no cancel verb'?**

> Observation body, Open question #1. `drop-source.ts` `dropSource` currently `git rm`s a task + sidecar; layout declares `tasks/cancelled/` as the task won't-proceed terminal (`work-layout.ts:90`, `CONTEXT.md:17`). The apply-rung half is already resolved by surface-stuck spec decision #5 (`delete`->`dispose`, regime-polymorphic); only the standalone CLI verb remains inconsistent.

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Should the verb be RENAMED for consistency now that the apply token is `dispose` (e.g. a `dispose <slug>` verb, with `drop` kept only if a true hard-`git rm` human escape hatch is wanted)? Weigh against churn on an existing verb.**

> Observation body, Open question #2. Surface-stuck spec renamed the apply disposition `delete` -> `dispose` (channel `disposeReason`). The CLI verb `drop` (cli.ts:3845) predates that and now diverges in name from the apply token.

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Fold this fix into `surface-stuck-as-questions-and-retire-stuck-lock-state` or split it into its own slice? That spec fixes the APPLY path; this is the standalone-verb consistency fix.**

> Observation body, Open question #3. Author flags it as 'likely a one-verb fix' orthogonal to but discovered by the surface-stuck spec.

_Suggested default: Split — surface-stuck is already resolved and near landing; a small standalone-verb slice keeps blast radius contained._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
