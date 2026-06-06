# 2026-06-06 — recovery `complete --propose` non-FFs the already-pushed work branch (latent, revealed by centralise-bounce-branch-push)

Noticed while consolidating the bounce-time branch push INTO the needs-attention
seam (`centralise-bounce-branch-push`).

Once an autonomous bounce pushes `work/<slug>` to the arbiter (which the real
`do`/`run` paths ALREADY did via the bolted-on `pushWorkBranch` before this slice,
and which the seam now does for everyone), a subsequent RECOVERY
`complete --propose` (re-gate green from `needs-attention/`) rebases the branch
DROPPING the historical `in-progress → needs-attention` move-only commit
(`rebaseDroppingNeedsAttentionSurface`). That REWRITES the branch tip vs the
already-pushed ref, so the integrator's propose push (`pushBranch`,
`work/<slug>:work/<slug>`, a PLAIN non-force push — `integrator.ts`) is a
NON-fast-forward and is REJECTED → `complete` exits 1 (usage-error).

- **Merge-mode recovery is unaffected** (it pushes `branch:main`, not the branch
  ref, so no collision).
- This is a PRE-EXISTING latent bug: `gate-fail-pushes-work-branch` (PR #9) made
  real `do`/`run` bounces push the branch, so a real `do --propose` recovery would
  already non-FF. The `complete-from-needs-attention` test only masked it because
  its setup simulated needs-attention via the bare seam call (which did NOT push
  the branch pre-this-slice); making the seam faithful (it now pushes) exposes it.

Fix shape (a follow-up slice, NOT this one — it is an integrator/complete concern,
not the bounce-push consolidation): the recovery `complete` propose push should
reconcile the rewritten branch with `--force-with-lease=work/<slug>` on the WORK
branch only (a requeued/recovering item is unshared — the same treatment
`continueFromKeptBranch` already uses for the onboard-time continue-push), NEVER a
plain `--force` and NEVER to main. Scope: `Integrator.integrate` propose path (or a
recovery-aware variant), with a test asserting a recovery `complete --propose` lands
the done-move on the pushed branch.
