---
title: review-gate non-blocking nits for 'needs-attention-as-stuck-lock-state' (Gate 2 approve)
date: 2026-06-18
status: open
reviewOf: needs-attention-as-stuck-lock-state
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'needs-attention-as-stuck-lock-state' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: every autonomous bounce path now ALSO marks the slice lock stuck, because the change is in the shared seam (`applyNeedsAttentionTransition` / `applyTreelessNeedsAttentionTransition`), not in one command. That means `do`, `run`, `start`, and the autonomous-refusal path in `complete.ts` all now additionally amend the `slice:<slug>` lock on any red gate / conflict / refusal. Is this intended breadth (it is consistent with the slice's 'a bounce ALSO marks' wording and the human local-only path is correctly excluded by the no-arbiter guard, tested via `delta`), or should it be scoped narrower?
  (The agent recorded no `## Decisions` block (the commit message has none), though the slice prompt asked it to. The keying `slice:${slug}` assumes the bounced item is always a slice; that holds because all these callers operate on claimed slices, and a `not-held` outcome (a non-slice or never-claimed item) is tolerated as a no-op — so it is safe, just broad and unrecorded.)
- Ratify the status/scan shape asymmetry: `status` only pushes a repo into `lockHeld[]` when `entries.length > 0` (so absent = no held locks), while `scan` always sets `RepoReport.lockHeld` per repo (possibly an empty array). Both are optional fields with documented 'empty = none / unreadable' semantics, so no consumer breaks, but the two surfaces report 'no locks' differently (omitted-repo vs empty-array). Intended, or should they be uniform?
  (status.ts pushes only when `entries.length > 0` and the docstring says 'Only repos WITH at least one held lock appear'; scan.ts always assigns `lockHeld` to the RepoReport literal. This mirrors how `needsAttention` is already handled in status (only repos with items appear), so it is at least locally consistent — flagged for ratification, not a defect.)
