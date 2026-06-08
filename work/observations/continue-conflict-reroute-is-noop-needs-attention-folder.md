# 2026-06-06 — run/start continue-conflict re-route through the seam is a NO-OP (findSourceFolder omits needs-attention/)

Noticed while building `centralise-bounce-branch-push` (writing the §14
continue-conflict reap test).

On an onboard-time CONTINUE rebase-conflict (`run.ts:310` / `start.ts`
`routeContinueConflict`), the runner calls
`ledgerWrite.applyNeedsAttentionTransition` to re-route the item to
needs-attention. But the continued worktree is cut from the KEPT `work/<slug>`
branch, whose tree already has the item in `work/needs-attention/<slug>.md` (the
PRIOR bounce moved it there). `routeToNeedsAttention`'s `findSourceFolder` only
probes `in-progress/` and `done/` — NOT `needs-attention/` — so it returns
`{moved: false}`: no new move-only commit, no surface re-publish, no branch push.

Consequence: a continue-conflict does NOT (re)surface the item as needs-attention
on `main` if `main` currently shows it elsewhere (e.g. `in-progress/` after the
re-claim). It RELIES on the item already being surfaced/recoverable from the prior
bounce (the kept branch is on the arbiter at its move-only tip, so recovery + the
§4 reap still work — the branch IS the durable artifact). So it is not a
work-loss bug, but the on-`main` surface can be STALE (showing in-progress while
the job is actually stuck on a continue-conflict).

This is PRE-EXISTING (independent of the push consolidation) and OUT OF SCOPE for
`centralise-bounce-branch-push`. Fix shape (a follow-up): either teach
`findSourceFolder` to also bounce from `needs-attention/` (idempotent re-surface),
or have the continue-conflict path surface directly. Small + bounded; revisit if a
stale continue-conflict surface bites a fleet's `scan`/`status`.

## Promoted 2026-06-08

PROMOTED to slice `work/backlog/continue-conflict-resurface-from-needs-attention.md`.
Delete this observation once that slice lands in `done/`.
