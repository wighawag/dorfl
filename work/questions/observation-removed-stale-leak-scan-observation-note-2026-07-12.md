<!-- dorfl-sidecar: item=observation:removed-stale-leak-scan-observation-note-2026-07-12 type=observation slug=removed-stale-leak-scan-observation-note-2026-07-12 allAnswered=false -->

Item: [`observation:removed-stale-leak-scan-observation-note-2026-07-12`](../notes/observations/removed-stale-leak-scan-observation-note-2026-07-12.md)

## Q1

**What should become of this observation note now that the incident it records is fully closed?**

> The note is a self-contained retrospective explaining why a prior stale observation (prd-word-leak-scan-fails-on-hard-cutover-task-body-2026-07-10.md) was deleted while finishing task merge-action-nits-followup. Verified against current reality: (a) the referenced task hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md is in work/tasks/done/; (b) merge-action-nits-followup is in work/tasks/done/; (c) packages/dorfl/test/prd-word-cutover-leak-scan.test.ts passes 4/4 locally; (d) this note keeps every retired-word token inside backticks, so it does not re-trip the WORD leak-scan (unlike the note it replaced). It carries no residual signal or open question — it is a done-record breadcrumb. Bucket is append-only, so keeping it is cheap; deleting it is also honest since the incident is resolved.

_Suggested default: Keep as-is in the append-only observations bucket as a done-record breadcrumb; no follow-up task, spec, or ADR._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Delete. The incident this note records is fully closed; nothing actionable or worth archiving remains.
