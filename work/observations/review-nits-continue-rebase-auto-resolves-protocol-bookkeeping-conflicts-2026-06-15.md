---
title: review-gate non-blocking nits for 'continue-rebase-auto-resolves-protocol-bookkeeping-conflicts' (Gate 2 approve)
date: 2026-06-15
status: open
slug: continue-rebase-auto-resolves-protocol-bookkeeping-conflicts
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'continue-rebase-auto-resolves-protocol-bookkeeping-conflicts' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Did the agent ratify, in a PR-description '## Decisions' block, (a) extending the sed matcher to tolerate the modern git interactive-todo prefix `pick <sha> # <subject>` — which also silently fixes the integration-site drop on git ≳2.31 — and (b) the empty-slug back-compat fallback in `rebaseContinuedBranchOntoMain` that degrades to a plain rebase?
  (The new `dropMoveOnlySequenceEditor` regex includes `\(# \)\{0,1\}` to tolerate both legacy and modern git todo-line formats. The previous integration-site regex (`^pick [0-9a-f]* chore(...): route to needs-attention`) did NOT have the optional `# ` — so on modern git the integration drop would have missed the bookkeeping commit. This is an in-scope improvement to the integration site beyond what the slice spelled out, and there is no test that pins the modern-git todo format specifically. The empty-slug → plain rebase fallback is also an API decision the slice did not call out explicitly; it is documented and back-compat-tested but a human should sign off.)
- Should there be an end-to-end test exercising the 'Post-drop SOURCE-FOLDER resolution at integration' interaction the slice called out (drop → agent re-run stub → `complete` lands `done/` with both prior and new code, no duplicate done-move, no conflict)?
  (The slice listed this as a verification criterion (`complete.ts ~L454` resolves the done-move source from `in-progress` else `needs-attention`, and a dropped-then-rebuilt continued branch could already have the slug in `work/done/`). The rebase-only tests cover the post-drop tree shape, but no test drives `performComplete` on that shape end-to-end. In practice the live failure trace does not include a done-move on the branch, so the scenario may not be reachable in the realistic case — but the criterion was explicit.)
- WORK-CONTRACT.md refers to the shared helper as `dropMoveOnlySequenceEditor`, but the exported, callable seam is `rebaseDroppingBookkeepingMoves` — should the protocol doc reference the helper that actually orchestrates the drop?
  (`dropMoveOnlySequenceEditor` is the inner sed builder inside `drop-bookkeeping-rebase.ts`; the function both sites call is `rebaseDroppingBookkeepingMoves`. The doc naming is mildly misleading for someone tracing the protocol claim into the code.)
