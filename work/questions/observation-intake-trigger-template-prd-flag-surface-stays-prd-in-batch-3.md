<!-- dorfl-sidecar: item=observation:intake-trigger-template-prd-flag-surface-stays-prd-in-batch-3 type=observation slug=intake-trigger-template-prd-flag-surface-stays-prd-in-batch-3 allAnswered=false -->

Item: [`observation:intake-trigger-template-prd-flag-surface-stays-prd-in-batch-3`](../notes/observations/intake-trigger-template-prd-flag-surface-stays-prd-in-batch-3.md)

## Q1

**What should become of this observation now that the deferred CLI-flag rename it was deferring to has fully landed?**

> The note (2026-07-09) records a deliberate decision to leave intake-trigger-template.ts on the prd spelling in batch 3 because the --merge-prd/--propose-prd CLI flags were owned by batch 4 (rename-spec-remaining-src-modules / cli.ts sweep). Current reality: work/tasks/done/ contains rename-spec-intake-cli-flags-and-residual-prd-identifiers.md plus rename-spec-remaining-src-modules-{a,b,c}.md, and grep for prd|Prd across cli.ts, intake.ts, and intake-trigger-template.ts returns zero matches — the flags are now --merge-spec/--propose-spec and the field is spec. So the signal has been fully discharged by later batches; nothing in current code contradicts or extends it. Nothing else in the note is left open (no design ambiguity, no follow-up marker).

_Suggested default: Delete it — it is a spent deferral record whose deferred work has fully landed; the git history of the batch-4 tasks preserves the rationale._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
