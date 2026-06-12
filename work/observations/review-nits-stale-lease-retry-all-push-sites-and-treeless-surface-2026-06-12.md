---
title: review-gate non-blocking nits for 'stale-lease-retry-all-push-sites-and-treeless-surface' (Gate 2 approve)
date: 2026-06-12
status: open
slug: stale-lease-retry-all-push-sites-and-treeless-surface
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'stale-lease-retry-all-push-sites-and-treeless-surface' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the asymmetric Part-B surface strategy across sibling sites: do.ts/run.ts (createJob path) call applyNeedsAttentionTransition with cwd = the job worktree (HEAD on the work branch, default pushBranch → re-attempts the just-failed work-branch push, best-effort), while start.ts (routeContinuePushFailure) cuts a throwaway temp branch off <arbiter>/main with pushBranch:false. Both are safe; the asymmetry is an in-scope, unrecorded design choice. The start.ts variant deliberately avoids mutating the human checkout's work branch and avoids a redundant re-push of the failed branch — it looks correct. Ratify, or unify on one seam.
  (start.ts routeContinuePushFailure cuts agent-runner/continue-push-failure-<slug> off <arbiter>/main with pushBranch:false; do.ts step 4b / run.ts step 2b pass cwd:tree.dir with no pushBranch override. Both reach needs-attention; only the surface mechanics differ.)
- Ratify the offline-vs-real classification boundary: start.ts isOfflinePushFailure treats the retry-cap give-up as always-real and matches offline ONLY against a fixed git-connectivity stderr allowlist (unable to access / could not read from remote / connection refused|reset|timed out / could not resolve host / ssh connect / network unreachable / ECONNREFUSED|ECONNRESET / ENOTFOUND / ETIMEDOUT), defaulting any unmatched cause to SURFACE. This is the correct conservative direction (never silently swallow), but the allowlist is a user-visible boundary: a connectivity error phrased outside these patterns would be (safely) surfaced to needs-attention rather than tolerated as offline. Ratify the allowlist + conservative default.
  (start.ts isOfflinePushFailure regex; the helper throws exactly two shapes (a '(not a stale lease)' raw-stderr failure and the cap-exhausted give-up). epsilon test covers the offline branch; zeta covers the surface branch.)
- Three acceptance criteria asked for the current per-site push-failure before-state, the start.ts catch discrimination, and the option-(a)-vs-(b) surface choice to be PINNED in a literal '## Decisions' block. No such block was produced as a deliverable — the rationale instead lives in inline code comments (isolation.ts/workspace.ts/start.ts/do.ts/run.ts) and the two observation notes. Ratify that the inline comments + observations satisfy the 'PIN in a ## Decisions block' requirement, or have the agent add the block.
  (grep for '## Decisions' in the slice/observation artifacts finds only the slice's own instructions, no produced block. Substance is fully present (isOfflinePushFailure docstring, the step-4b comments, the resolved + follow-up observations). Bookkeeping gap, not a correctness defect; already noted in the prior review-nits observation.)
- Process/integration ratification (for the runner, not a code defect): the theta end-to-end performDoRemote test (handoff point #4), the vitest.config.ts race-sensitive registration of stale-lease-all-push-sites.test.ts, and the follow-up tree-less observation are UNCOMMITTED working-tree / untracked changes on the branch — they are NOT in origin/main..HEAD. Confirm the runner scoops the full working tree into the integration commit so these land; if only the committed tip is integrated, point #4 and the option-(b) follow-up observation would be lost.
  (git diff origin/main..HEAD omits theta/performDoRemote (0 hits) and vitest.config.ts; git diff (working tree) carries them (15 hits) plus the untracked work/observations/treeless-surface-for-after-commit-push-failure.md. Normal under the agent-no-git contract, but the green gate is over the full tree, so the runner must commit the full tree.)
