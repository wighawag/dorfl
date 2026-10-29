---
title: 'A `requeue -m` note that main refuses is delivered on the kept work branch; a refused push is never read as a lost race'
status: accepted
created: 2026-10-29
decided: 2026-10-29
supersedes:
superseded_by:
---

# ADR: deliver a refused `requeue -m` note on the kept work branch, and classify a refused `main` push by asking the arbiter

## Context

`requeue <slug> -m "<note>"` writes a dated `## Requeue YYYY-MM-DD` section into the item body on `<arbiter>/main` through the ledger write seam (`ledgerWrite.applyTransition`, a leased push to `main`). On a repository whose `main` is protected (required checks, everything lands through PRs in propose mode) that push is refused by the remote. The seam returned the same `rejected` kind for every failed push, so the tree-less move loop read the refusal as "main advanced under us", retried five times, then dropped the note with a warning and released the lock. The note was the only record of why the task was being rebuilt, and the next run continued from the kept branch without it.

## Decision

1. **A refused push is its own outcome.** When a leased push to `main` fails, the seam asks the arbiter (`ls-remote`) where `main` is. If `main` is still the expected base, nothing moved, so the lease was not what failed: the result is `refused`, carrying the remote's own error text, and callers never retry it. Only when `main` did move (or the arbiter cannot be read and the push stderr is race-shaped: a stale lease, a non-fast-forward, `fetch first`, or a ref the remote could not lock or update) is it `rejected`, the retryable race. Asking the arbiter is preferred over matching stderr because hosts word refusals differently, while "did `main` move?" is the exact question the retry assumes the answer to.
2. **The note falls back to the kept `work/<type>-<slug>` branch.** If the note cannot land on `main` for any reason, and a kept branch ahead of `main` exists, the requeue commits the same `## Requeue` section onto the item body that branch carries (the done record when the prior run already done-moved it, else the pool or staging body) and pushes it with a lease on the observed tip, through `refWrite.pushLeasedWorkBranch`.
3. **If neither home is available** (for example `--reset` discarded the branch), the requeue still releases the lock, but prints the note in full between explicit begin and end markers and returns it as `handoffNoteUndelivered`; the `requeue` command then exits non-zero, so it is never silently lost.

## Considered options

- **The kept branch (chosen).** The next claim continues from that branch, and the existing continue path already reads every `## Requeue` section of the body it resolves there (`resolveTask` admits the done record on a stranded continue, `resolveContinueContext` extracts the notes). No new reader, no new ref, and it works the same in-place and in a bare-mirror job worktree. Cost: the note becomes a commit on the open PR, so it re-triggers that PR's CI and, if the PR merges, the note lands in the done record on `main`. Both are acceptable: the PR is being rebuilt anyway, and a requeue reason in the done record is useful history.
- **Carry the note on the per-item lock.** Rejected: the requeue RELEASES the lock, so the note would vanish with it unless the release were changed to keep a lock-shaped record around, which contradicts the lock being the in-flight hold only.
- **A side ref (`refs/dorfl/requeue-note/<slug>`).** Rejected: needs a new writer, a new reader in both continue paths, and a cleanup story for stale refs, all to store text the branch can already carry.
- **Fail the requeue before releasing the lock.** Rejected as the default: an earlier observation showed that stranding the lock for an optional note leaves a half-applied state (on `--reset` the branch is already gone). Printing the note in full keeps it recoverable without that.

## Consequences

- On a protected `main`, `requeue -m` no longer prints retry chatter; it says the push was refused and quotes the remote.
- The `rejected` path is unchanged for real races. Other `applyTransition` callers that only test for `published` (the advancing-lock create) still treat `refused` as a retryable rejection; that is recorded as an observation rather than changed here.
- On an unprotected `main` the note goes to `main` exactly as before; the branch fallback only runs when `main` did not take it.
