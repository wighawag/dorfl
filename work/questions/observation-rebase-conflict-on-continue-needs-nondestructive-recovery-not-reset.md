<!-- dorfl-sidecar: item=observation:rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset type=observation slug=rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset allAnswered=false -->

## Q1

**What becomes of this signal? It is narrowed (per its own 2026-06-20 triage Update) to a recovery-ergonomics concern with three still-live points: (1) no non-destructive recovery verb exists; (2) "resolve against latest main" is not actionable for a mirror-side branch; (3) default `requeue` refuses when no work branch exists, forcing the destructive `--reset` even when there is nothing to lose. Should these become one or more tasks, a PRD, an ADR, get folded into existing work, or be dropped?**

> Re-verified against current `main`:
> - Point 1 confirmed: `cli.ts` `requeue` exposes only `--reset` (+ `-m`); no `--reconcile`/`--rebase` flag. The done task `recovery-rebase-retry-against-moving-arbiter-main` addresses a DIFFERENT aspect (auto-retrying a rebase against a concurrently-MOVING arbiter/main, i.e. transient races), NOT a user-facing non-destructive recovery verb for a genuine continue-conflict.
> - Point 2 confirmed: no supported command fetches the kept branch into a scratch worktree, rebases, and re-pushes.
> - Point 3 (the high-sev addendum) confirmed STILL LIVE at `packages/dorfl/src/needs-attention.ts:597`: the default keep+continue requeue returns `{moved:false}` with "the work branch … isn't on <arbiter> … push it first, or `requeue --reset` to discard" when the arbiter continue-branch is absent — so moving a branch-less needs-attention item back to backlog still nudges toward the destructive flag.
> The note's own Disposition flags the open design call explicitly: "whether to add a non-destructive verb vs. make the no-branch requeue succeed by default is a design call." The headline bookkeeping-conflict half is already structurally dissolved (per-item-lock cutover) and out of scope.

_Suggested default: to-task — mint at least the point-3 fix (default requeue should move a branch-less needs-attention item to backlog WITHOUT `--reset`, since keep+continue and start-fresh are identical when there is no branch) as a small, well-scoped task; treat the non-destructive recovery verb (points 1-2) as a separate design item (task or short PRD) if the broader affordance is wanted. Do not drop: all three points are verified live._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Mint the point-3 fix now as a small, well-scoped task: default `requeue` should move a branch-less needs-attention item back to backlog WITHOUT `--reset`, since keep+continue and start-fresh are identical when there is no work branch to lose (packages/dorfl/src/needs-attention.ts:597). Treat the non-destructive recovery verb (points 1-2: a `--reconcile`/`--rebase` affordance that fetches the kept branch into a scratch worktree, rebases against latest main/arbiter, and re-pushes) as a SEPARATE design item, a task or short PRD, to be picked up if the broader affordance is wanted. Do not drop: all three points are verified live on current main.
