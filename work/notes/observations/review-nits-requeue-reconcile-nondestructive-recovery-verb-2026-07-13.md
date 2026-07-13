---
title: review-gate non-blocking nits for 'requeue-reconcile-nondestructive-recovery-verb' (Gate 2 approve)
date: 2026-07-13
status: open
reviewOf: requeue-reconcile-nondestructive-recovery-verb
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'requeue-reconcile-nondestructive-recovery-verb' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: attemptReconcile PUSHES the reconciled tip back to the arbiter with --force-with-lease from a scratch worktree. The task item-1 Action specified re-sync + retry rebase + backlog move; it did not spell out pushing the rebased branch back, and 'fetch into scratch worktree, rebases, and re-pushes' is the shape scoped to the DEFERRED point-2 command. Coherent extension (leaves the arbiter in a consistent post-rebase state so the next claim continues from truth), but an in-scope decision that should have been in a Decisions block in the PR body.
  (packages/dorfl/src/needs-attention.ts attemptReconcile step 4; task file 'What to build' item 1 + Out-of-scope point 2.)
- Ratify: agent introduced a CLI-level process.exit(1) refusal for --reconcile + --reset combined, in addition to the returnToBacklog-level moved:false guard. New user-visible refusal; harmless duplicate, but not called for in the task.
  (packages/dorfl/src/cli.ts requeue handler around the mutual-exclusion check; packages/dorfl/src/needs-attention.ts returnToBacklog reconcile branch has the same guard.)
- UX: when attemptReconcile fails on a push-lease rejection (not a real rebase conflict), the returned message still headlines 'the rebase still conflicts on genuine content (push of reconciled tip rejected…)'. Headline is misleading for the lease-rejection case; consider splitting the ReconcileAttempt conflict variant into rebase-vs-push subkinds.
  (packages/dorfl/src/needs-attention.ts: attemptReconcile returns {kind:'conflict', detail:'push of reconciled tip rejected …'}; caller formats '…still conflicts on genuine content (${detail})'.)
- Dead param: attemptReconcile takes a `note` callback but the body only does `void note;`. Either wire progress notes through (mirror re-sync started, rebase clean, pushing…) or drop the param.
  (packages/dorfl/src/needs-attention.ts attemptReconcile signature + body.)
