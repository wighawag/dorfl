---
item: observation:rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset
type: observation
slug: rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset
allAnswered: false
---

## Q1
id: q1
question: |
  How should this observation be dispositioned: promote it to a slice (or PRD) that implements the three remedies it proposes — (1) auto-resolve protocol-mechanical rebase conflicts on continue, (2) add a non-destructive `requeue --reconcile`/`--rebase` recovery verb and lead the error message with it, (3) allow default `requeue` on a needs-attention slice with NO branch to move it back to backlog without forcing `--reset` — or keep it as a standing observation, fold it into an existing nearby observation, or close it?
context: |
  Observation `rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset.md` (status: open, severity: high) reports that when `do --isolated` continues a kept `work/<slug>` branch and rebase onto latest main conflicts, the only offered escape is the destructive `requeue --reset`, which (a) discards correct, building work (the diff matched all acceptance criteria; commit 58bf7d5 was sound), (b) in this run did not even fix the situation because of a stale mirror ref (cross-ref `requeue-reset-does-not-prune-hub-mirror-stale-branch-ref.md`), and (c) the conflict itself was not a real content clash but protocol bookkeeping (slice `.md` lifecycle move plus appended `-m` handoff notes) the runner owns both sides of and should auto-resolve. An addendum documents a second `--reset` nudge: default `requeue` refuses to move a needs-attention slice back to backlog when no branch exists, again pointing at `--reset` even though there is nothing to discard. The observation explicitly proposes three concrete remedies and a broader principle ("recovery affordances should be non-destructive by default and fire on genuine errors"). Related review-nit slices already exist — `review-nits-continue-rebase-auto-resolves-protocol-bookkeeping-conflicts-2026-06-15.md` and `review-nits-onboard-and-reset-reconcile-mirror-to-arbiter-2026-06-16.md` — which may already cover parts (1) and the mirror-reconcile angle; the non-destructive `requeue --reconcile` verb and the no-branch-requeue-to-backlog fix do not obviously map to an existing slice.
default: |
  promote-slice — author a slice covering the non-destructive `requeue --reconcile` verb, the no-branch requeue-to-backlog behaviour, and the error-message reordering; cross-link to the existing review-nit slices that already cover bookkeeping-conflict auto-resolution and mirror reconcile so work is not duplicated.
answered: false
answer: |
disposition: promote-slice
