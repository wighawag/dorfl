---
title: review-gate non-blocking nits for 'agent-stop-signal' (Gate 2 approve)
date: 2026-06-08
status: open
slug: agent-stop-signal
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'agent-stop-signal' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for batch-qa triage (promote-to-slice / keep / delete).

- `extractDecisionsBlock` (src/agent-stop.ts) is exported, fully documented, and unit-tested, but is never called from any production code path. Wire it into the optional review-nits observation fold (its documented purpose) or remove it, so the codebase doesn't ship exported-but-uncalled scaffolding that implies a surfacing path that isn't actually invoked.
  (grep shows the only references are in test/agent-stop.test.ts and its own docstring; no src/*.ts call site. The slice marked the review-nits fold OPTIONAL and Part B's mandatory surfacing is met by agent.output already being the PR body, so this is dead-but-tested code, not a missing criterion.)
- The shared-helper test fixtures (run.test.ts, run-loop.test.ts) had to change `editingAgent` to write SLUG-SPECIFIC content because byte-identical content tripped the empty-diff backstop. The justification comment ('the second's diff vs the advanced main genuinely empty') describes a diff-vs-arbiter-main scenario, but the implementation actually checks working-tree status against the claim base (which would NOT be empty for a freshly-created/modified file regardless of what merged first). The fix is harmless and correct, but the comment's stated rationale doesn't match the implemented mechanism — worth reconciling so a future reader doesn't misunderstand when the backstop can false-positive.
  (isWorkBranchDiffEmpty uses `git status --porcelain` at a point where the work branch HEAD is still the claim commit; the helper-change comments in run.test.ts/run-loop.test.ts reason about a diff against an advanced main instead.)
