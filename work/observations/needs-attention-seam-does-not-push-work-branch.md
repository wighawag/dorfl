# needs-attention seam surfaces on main but does NOT push the work branch

2026-06-06 (noticed while building `agent-fail-saves-work`)

`ledgerWrite.applyNeedsAttentionTransition(arbiter)` (mode-M) **strips the arbiter
from the move** and only publishes the move-only commit's ledger effect onto
`<arbiter>/main` (via `publishSurfaceCommit`). It does NOT push the `work/<slug>`
branch to the arbiter — the wip (agent work) commit stays only on the local branch
(in `run`/`do`'s job worktree, which is disposable).

This contradicts the in-code comment in `run.ts` (the gate-fail path) that says
"Passing the arbiter both pushes the work branch (saving the wip cross-machine) and
makes the stuck state observable" — the seam does NOT push the branch. So the
gate-fail path's wip is NOT cross-machine recoverable today: a `requeue`-continue
on a *different* machine would find no `<arbiter>/work/<slug>` ahead of main (the
continue-detection in `continue-branch.ts` reads `<arbiter>/work/<slug>`), so it
would re-cut fresh off main and the gate-fail wip would be orphaned. The
`requeue-continue-and-reset` test only proves recovery because IT manually
`git push`es the work branch before routing.

For the `agent-fail-saves-work` slice I made the agent-fail path explicitly push
the work branch to the arbiter (in addition to the seam's main surface) so its
acceptance criterion (requeue-continue recovers the partial commits, cross-machine)
holds. The parallel question — whether the GATE-FAIL path (`run`/`complete`)
should also push the work branch so its wip is equally cross-machine recoverable —
is OUT OF SCOPE for this slice but looks like a latent gap worth a look.
