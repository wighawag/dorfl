---
title: review-gate non-blocking nits for 'job-record-out-of-committed-tree' (Gate 2 approve)
date: 2026-06-14
status: open
slug: job-record-out-of-committed-tree
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'job-record-out-of-committed-tree' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- RATIFY: the agent added an explicit `removeJobRecord(dir)` on teardown (in `Job.dispose()` and `gc.ts removeWorktree`) — an in-scope decision the slice did not spell out. Because the record is now a SIBLING of the worktree, `git worktree remove` no longer deletes it along with the dir (when it lived inside the tree it went away WITH the worktree), so without this explicit teardown a reaped job would leave a `<work-id>.json` orphan that `discoverJobs` would correctly ignore (it keys on the worktree dir) but which would litter `workspacesDir/work/`. The handling is correct, idempotent/best-effort, deletes both the new and legacy paths, and is tested at the reap path (gc.test.ts asserts the sibling is gone after reap). Confirm this is the intended litter-cleanup behaviour.
  (src/workspace.ts removeJobRecord + dispose() ~L353; src/gc.ts removeWorktree ~L482; gc.test.ts:186 asserts `${job.dir}.json` is gone after reapJob. Job.dispose() is exercised in stale-lease-all-push-sites.test.ts:499 (without a dedicated sibling-removal assertion there, but the reap path covers the orphan case).)
- INTEGRATOR CHECK (from work/observations/in-flight-old-location-record-during-self-relocation.md): the runner that dispatched THIS job is an OLD binary and wrote a live `.agent-runner-job.json` at the worktree ROOT (this checkout's repo root). With the gitignore entry now removed by this very diff, that stray record shows as untracked (`git status` shows `?? .agent-runner-job.json`) and the runner's own broad `git add -A` completion commit could sweep it onto the work branch — the exact leak this slice closes — purely because the dispatching binary predates the fix. This is benign, transient, and self-resolving once agent-runner is rebuilt from this branch, and the read-fallback keeps such records discoverable. When integrating, confirm `.agent-runner-job.json` is NOT committed onto the `work/job-record-out-of-committed-tree` branch.
  (git status shows `?? .agent-runner-job.json` at repo root; `git check-ignore` now returns NOT IGNORED (entry removed by this diff). This is the textbook old-location in-flight migration case the slice's step 5 anticipates, observed live during the self-hosting build.)
