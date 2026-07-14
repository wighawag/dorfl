<!-- dorfl-sidecar: item=task:rename-gc-ledger-stuck-lock-report-to-orphan-lock type=task slug=rename-gc-ledger-stuck-lock-report-to-orphan-lock allAnswered=false -->

## Q1

**'task:rename-gc-ledger-stuck-lock-report-to-orphan-lock' was bounced — how should we proceed?**

> acceptance gate failed (exit 1) on the rebased tip

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):

Resolve, CONTINUE (keep the work branch). This bounce was NOT a defect in this task: the acceptance gate failed on a PRE-EXISTING `prd->spec` leak-scan failure on `main` (an un-backticked `slice-*/prd-` token in the auto-generated `backfill-where-it-runs-decision-migrate-stuck-locks-done-record` task body, line 20). The agent correctly diagnosed this and left the observation `word-cutover-leak-scan-red-on-backfill-task-2026-07-14`. That leak is now FIXED on main (backticked, leak-scan green). This task's own work is sound and complete: it renames the gc/ledger "stuck-lock report" -> "orphan-lock report" in `WORK-CONTRACT.md` (both protocol mirrors, byte-identical) + one test describe label, matching the task exactly. Keep the branch and re-gate on the now-green main; it should pass cleanly.
