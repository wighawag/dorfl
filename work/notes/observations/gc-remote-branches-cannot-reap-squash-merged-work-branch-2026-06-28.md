---
title: gc --remote-branches (and the merge-reap) use only `merge-base --is-ancestor`, so a SQUASH-merged work/<slug> branch is never provably-merged and orphans forever
type: observation
status: spotted
spotted: 2026-06-28
slug: gc-remote-branches-cannot-reap-squash-merged-work-branch
needsAnswers: false
---

## What was seen

A lingering remote branch `origin/work/task-reaper-no-lock-outcome-benign-not-lost`
survived every scheduled `gc --remote-branches` tick. Its tip
(`284853670bfa0e424f0233a31f131bb3d73d9697`, authored `agent-runner[bot]`
2026-06-21) was NOT an ancestor of `origin/main`
(`git merge-base --is-ancestor <tip> origin/main` exits non-zero), yet:

- the work HAD landed on `main` as a SQUASH commit
  `2e025ae feat(reaper-no-lock-outcome-benign-not-lost): … done (#186)`;
- the done record `work/tasks/done/reaper-no-lock-outcome-benign-not-lost.md`
  is present on `origin/main`;
- a `git diff origin/main <tip>` showed the branch MISSING 120 files /
  ~58k lines that exist on `main` (the branch is just far behind a
  since-advanced main; it carries nothing main lacks).

It had to be removed by a manual
`git push origin --delete work/task-reaper-no-lock-outcome-benign-not-lost`
(2026-06-28).

## Root cause (verified against the reaper code)

The remote-branch reaper and the in-process merge-reap BOTH decide "provably
merged" with ONLY `git merge-base --is-ancestor <tip> <arbiter>/main`:

- `packages/dorfl/src/reap-branches.ts` — the `--remote-branches` sweep
  (`reapMergedRemoteWorkBranches`): delete iff `<tip> --is-ancestor` of the
  fetched main.
- `packages/dorfl/src/gc.ts` (~L23/L109/L437-452) — the shared ancestry
  primitive used by the worktree reaper and the remote-branch sweep.
- `packages/dorfl/src/integrator.ts` (L686, L766), `integration-core.ts`
  (L1439), `complete.ts` (L1323), `isolation.ts` (L405) — the merge-reap +
  recovery callers, all the SAME ancestry test.

Ancestry is true for a fast-forward / true-merge land, but a SQUASH merge (the
default for many GitHub repos, and what PR #186 used) creates a NEW commit with
the branch tip as NO ancestor. So a squash-landed branch is, by construction,
never "provably merged" by this predicate and is never reaped.

## Why it matters

The reaper exists precisely to clean up `work/<slug>` branches after their work
lands. A repo that squash-merges its PRs (a very common default) accumulates a
lingering `work/<slug>` branch for EVERY landed item, forever — the opposite of
the reaper's intent. The `gc --remote-branches` job is then mostly inert hygiene
that never actually cleans the common case. This is the branch-side twin of the
lock-side orphan in
`reaper-never-clears-a-done-plus-stuck-lock-orphans-forever-2026-06-20`
(both: the durable `main` record says the item is terminal, but the
ancestry-only predicate cannot see it, so the orphan survives).

## Suggested fix shape (decide when tasking)

Strengthen the "provably merged / safe to reap" predicate so a squash-landed
branch is reapable WITHOUT loosening the safety floor (never reap an in-flight /
unmerged branch, never `--force`). Candidate signals, all derivable from the
durable `main` record (which is authoritative):

- the item is TERMINAL on `<arbiter>/main` (its done/dropped/tasked record
  exists on main) AND the branch tip carries nothing main lacks
  (`git diff <arbiter>/main <tip>` is empty, i.e. `git merge-base <tip> main`
  == `<tip>`-relative is fully reflected) — i.e. "the branch's content is a
  subset of main"; or
- `git cherry <arbiter>/main <tip>` reports every branch commit as already
  applied (the `-` / patch-id equivalence path that catches squash + rebase).

Keep the ancestry path as the cheap fast case; add the terminal-on-main +
content-subset (or cherry/patch-id) check as the squash-aware fallback. Pin with
tests: (a) a squash-merged branch whose item is done-on-main IS reaped;
(b) an in-flight / genuinely-unmerged branch is STILL retained. Note the GitHub
`delete_branch_on_merge` repo-setting (offered by install-ci) covers the GitHub
case but NOT a `--bare`/non-GitHub arbiter, so this provider-agnostic sweep is
still the only floor and must handle squash itself.

## Refs

- `packages/dorfl/src/reap-branches.ts`, `gc.ts`, `integrator.ts`,
  `integration-core.ts`, `complete.ts`, `isolation.ts` — all use
  `merge-base --is-ancestor` as the sole merged-ness test.
- The incident: orphaned `origin/work/task-reaper-no-lock-outcome-benign-not-lost`
  from squash-merged PR #186, deleted manually 2026-06-28.
- Sibling (lock-side twin): `reaper-never-clears-a-done-plus-stuck-lock-orphans-forever-2026-06-20`.
- The GitHub-only convenience that does NOT cover bare arbiters:
  `delete_branch_on_merge` (`install-ci.ts` L216-234, `install-ci-github.ts`).
