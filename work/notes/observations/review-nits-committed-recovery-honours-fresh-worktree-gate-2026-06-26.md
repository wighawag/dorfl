---
title: review-gate non-blocking nits for 'committed-recovery-honours-fresh-worktree-gate' (Gate 2 approve)
date: 2026-06-26
status: open
reviewOf: committed-recovery-honours-fresh-worktree-gate
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'committed-recovery-honours-fresh-worktree-gate' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: the recovery-tail gate does NOT thread the build path's `review` callback into `runFreshWorktreeGate`. Intentional (answered-merge land has no Gate-2 review semantics today) but it is a deliberate divergence from the build path's `freshWorktreeGate && !skipVerify && !lifecycle` branch the task said to mirror. OK to keep?
  (integration-core.ts ~L1815-1830 calls runFreshWorktreeGate with prepare/verify/env/note only; build path at L1266 also passes `review:` when `input.review`. Recovery omits it unconditionally.)
- Ratify new user-visible reason strings introduced on the recovery red-gate path ('... on the rebased tip during committed-recovery; routed ...' / '... not integrating ...'). These differ from the build path's analogous strings ('... on the rebased tip; routed ...' / '... not completing ...') and will surface in needs-attention messages.
  (integration-core.ts ~L1845-1855 vs build path ~L1322-1330.)
