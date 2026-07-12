<!-- dorfl-sidecar: item=observation:prd-word-leak-scan-fails-on-hard-cutover-task-body type=observation slug=prd-word-leak-scan-fails-on-hard-cutover-task-body allAnswered=false -->

Item: [`observation:prd-word-leak-scan-fails-on-hard-cutover-task-body`](../notes/observations/prd-word-leak-scan-fails-on-hard-cutover-task-body.md)

## Q1

**This observation is already resolved by reality — what becomes of the signal: delete the note, or keep it as a historical record?**

> The observation (work/notes/observations/prd-word-leak-scan-fails-on-hard-cutover-task-body.md) reports that prd-word-cutover-leak-scan.test.ts fails because work/tasks/ready/hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md contains standalone 'prd' tokens, and states the fix is 'that task landing'. Current reality: the task has landed — it now sits in work/tasks/done/hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md (no longer in ready/), and running the scan today (packages/dorfl, vitest run test/prd-word-cutover-leak-scan.test.ts) shows 4/4 passing. The predicted fix occurred; the signal has no residual action.

_Suggested default: Delete the observation note (direct-delete discharge) — the condition it flagged is gone and its intended fix (task landing) has happened._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
