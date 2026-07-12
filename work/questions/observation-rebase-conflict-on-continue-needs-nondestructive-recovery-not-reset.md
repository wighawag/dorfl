<!-- dorfl-sidecar: item=observation:rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset type=observation slug=rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset allAnswered=false -->

Item: [`observation:rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset`](../notes/observations/rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset.md)

## Q1

**What should become of this observation's remaining live residue — specifically (a) adding a non-destructive recovery verb like `requeue --reconcile`/`--rebase` (re-sync mirror + retry rebase, keep the work) and re-ordering the continue-conflict error message to lead with it rather than `--reset`, and (b) making 'resolve against latest main' actionable for an isolated/mirror-side branch via a supported command (fetch kept branch into scratch worktree, rebase, re-push) instead of telling the user to do raw git on a branch the skill forbids touching? Mint a task/spec for one or both, defer, or discard?**

> Note at work/notes/observations/rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset.md. 2026-06-20 triage narrowed scope: point 1 (auto-resolve bookkeeping conflicts) STRUCTURALLY DISSOLVED by per-item-lock cutover; point 3 addendum (default requeue when no branch exists) RESOLVED-BY task default-requeue-succeeds-when-no-work-branch-exists (2026-07-07). Verified still live against current main: cli.ts requeue command exposes only default keep+continue and `--reset` (line ~3516, 3528) — no `--reconcile`/`--rebase` flag; no scratch-worktree resolve command. So the destructive `--reset` remains the only offered escape from a genuine content conflict on continue, which can throw away correct built work.

_Suggested default: Mint a task for (a) — a `requeue --reconcile` (or make plain `requeue` retry after re-syncing the mirror) plus reworded error message leading with the non-destructive option — since it is the concrete, self-contained UX fix the note keeps pressing on; treat (b) as a follow-up design item (may want its own spec) rather than folding it into the same task._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Promote (a) to a task now; defer (b) as a follow-up. Part (a) is a real, self-contained UX-safety gap: add a non-destructive recovery verb (requeue --reconcile / --rebase that re-syncs the mirror + retries the rebase, keeping the work) and re-order the continue-conflict error message to LEAD with it rather than --reset. Part (b) (making 'resolve against latest main' actionable for an isolated/mirror-side branch via a supported command instead of raw git on a forbidden branch) is a larger design piece; keep it as a deferred follow-on referenced from the (a) task.
