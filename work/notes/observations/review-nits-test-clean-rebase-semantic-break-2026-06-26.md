---
title: review-gate non-blocking nits for 'test-clean-rebase-semantic-break' (Gate 2 approve)
date: 2026-06-26
status: open
reviewOf: test-clean-rebase-semantic-break
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'test-clean-rebase-semantic-break' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the test-internal fixture choices the agent made without a Decisions block: (a) the marker channel is a process-env var DORFL_TEST_MARKER pointing at a path outside any worktree (so the throwaway fresh-gate worktree reaping does not eat it); (b) the verify script appends one JSON line per run capturing {util, callerExists}; (c) the test uses TWO independent clones (one per work branch) so A's uncommitted edits cannot contaminate B. These are test-only, no cross-task surface, but were not enumerated in the PR description.
  (packages/dorfl/test/clean-rebase-semantic-break.test.ts (verify-marker env var + JSON-line marker + two-clone fixture); HEAD commit message has no Decisions block.)
