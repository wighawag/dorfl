<!-- dorfl-sidecar: item=task:backfill-where-it-runs-decision-migrate-stuck-locks-done-record type=task slug=backfill-where-it-runs-decision-migrate-stuck-locks-done-record allAnswered=false -->

## Q1

**'task:backfill-where-it-runs-decision-migrate-stuck-locks-done-record' was bounced — how should we proceed?**

> acceptance gate failed (exit 1) on the rebased tip

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):

Resolve, CONTINUE (keep the work branch). The bounce was the PRE-EXISTING `prd->spec` leak-scan failure on `main`, not a defect in the built work: this task's OWN body (line 20, `slice-*/prd-`) carried the un-backticked token that tripped the tree-wide scan and turned it RED for the whole pool. That leak is now FIXED on main (the token is backticked; leak-scan green). The branch's actual deliverable is sound and complete: it adds a thorough `## Decisions` block to `work/tasks/done/migrate-existing-stuck-locks-one-shot.md` recording the where-it-runs choice (dedicated `dorfl migrate-stuck-locks` verb) with rationale and the `cli.ts:3909-3920` back-reference — exactly what the task asked for, and its own added text is clean (no bare `prd`). Keep the branch; on re-claim it rebases onto the fixed main (inheriting the backticked body) and should re-gate green.
