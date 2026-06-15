---
title: requeue --reset deletes the arbiter branch but leaves a STALE remote-tracking ref in the hub mirror, so the next `do` resurrects the deleted branch, "continues from kept work", and rebase-conflicts forever
date: 2026-06-15
status: open
severity: high
---

## The signal (reproduced live in a drive-backlog run)

Sequence on slice `serialise-surface-treeless-moved-false-test-under-parallel-load`:

1. `do --isolated` built it CORRECTLY (commit `58bf7d5`, "…add to RACE_SENSITIVE; done"), then the fresh-worktree gate failed for an UNRELATED env reason (no `prepare` step → no `node_modules` → `prettier: not found`). Routed to needs-attention. (Separate observation: `do-should-fail-fast-when-prepare-or-verify-unset.md`.)
2. Fixed config (added `prepare`), `requeue` (keep+continue), re-`do`. It reported:
   `continuing the kept work/slice-…: rebase onto the latest main conflicted (aborted, never auto-resolved)`.
3. Assuming the kept branch was entangled, ran `requeue --reset` — which **deleted the remote branch on `origin`** and reported success.
4. Re-`do` AGAIN. It STILL said `Continuing '…' from the kept origin/work/slice-… (requeue)` and conflicted AGAIN — even though `--reset` had deleted that branch.

## Root cause

`do --isolated` does NOT read branch existence from the real arbiter (`origin`); it reads from the **hub mirror** at `~/.agent-runner/repos/github-com/wighawag/agent-runner.git`. After `--reset`:

- `git ls-remote origin 'refs/heads/work/*serialise*'` → EMPTY (branch genuinely deleted on the real remote). ✅
- `git --git-dir=<mirror> for-each-ref | grep serialise` → STILL PRESENT:
  `9e9847c… refs/remotes/origin/work/slice-serialise-…` ❌ (the deleted branch's old tip, cached).

`requeue --reset` deletes the branch on the arbiter remote but NEVER prunes the mirror's remote-tracking ref. So the mirror is left INCONSISTENT with the arbiter, and the next `do`'s onboard trusts the stale mirror ref, "continues from the kept branch" (content from BEFORE the reset and far behind main), and rebase-conflicts. The conflict is therefore NOT a genuine content conflict — it is an artifact of agent-runner's own incomplete state, and it RECURS because `--reset` is structurally incapable of clearing it.

Worse: a plain `git --git-dir=<mirror> remote prune origin` was ALSO a no-op here (the mirror has no/!= fetch refspec mapping that prunes `refs/remotes/origin/work/*`), so even a manual prune attempt did not clear it. The stale ref had to be deleted by hand.

## Why it matters

- `--reset` SILENTLY FAILS its one job ("start fresh"): it discards the kept work (irreversibly, on the remote) yet the next claim STILL continues from a stale copy of that work, so the user pays the cost (lost branch) without the benefit (clean restart). I discarded correct, building work for nothing.
- The conflict it was meant to resolve is itself self-inflicted (incomplete operation), so the user is pushed toward the guarded, destructive `--reset` to escape a problem agent-runner created — exactly the wrong incentive.

## What SHOULD happen (design intent)

1. **`do`/`run` onboard must derive branch existence from the ARBITER, not a possibly-stale mirror ref.** Before "continue from kept branch", reconcile the mirror against the arbiter (`fetch --prune` with a refspec that actually prunes `work/*`, or `ls-remote` the arbiter and treat the arbiter as truth). A mirror ref with no arbiter counterpart is stale and must be ignored/pruned, never resurrected.
2. **`requeue --reset` must also purge the mirror's tracking ref** for the branch it deletes (or, better, deletion should always go through a path that keeps every mirror consistent — one-mutation-many-mirrors invariant). After `--reset`, NO copy of the branch (remote OR mirror) may remain.
3. **A reconcile/repair affordance.** There should be a smooth, NON-destructive way to disentangle a "rebase conflicted on continue" situation: e.g. `agent-runner requeue --rebase`/`--reconcile` that re-syncs the mirror to the arbiter and retries the rebase, OR an explicit "the kept branch is fine, just re-onboard cleanly" path — so the user is NOT forced to choose between a stuck loop and the destructive `--reset`.

## The broader principle (user's framing)

These stops should fire on GENUINE errors, not on agent-runner's own incomplete operations. Here, THREE separate stops in one slice were all self-inflicted: (a) env-config gap surfaced as a build failure, (b) a rebase conflict that was really a stale-mirror artifact, (c) a `--reset` that claimed to start fresh but couldn't. Each routed CORRECT work to needs-attention, muddying that signal. The fix is to make the runner reconcile its own derived state (mirror vs arbiter) BEFORE deciding to "continue", and to make recovery affordances non-destructive by default.

## Possible slice shapes (later)

- **Onboard reconciles mirror to arbiter before "continue from kept".** At the seam where `do` decides kept-branch-exists, compare against `ls-remote <arbiter>`; prune any mirror tracking ref absent from the arbiter; only then decide continue-vs-fresh. Test: simulate a mirror with a tracking ref whose arbiter branch was deleted; assert `do` starts fresh (does NOT continue/conflict).
- **`requeue --reset` prunes the mirror too.** After deleting the arbiter branch, delete the corresponding mirror ref (all known mirrors for that repo). Test: after `--reset`, assert NO mirror retains the branch ref.
- **Non-destructive `--reconcile`/`--rebase` recovery.** A keep-the-work path that re-syncs and retries the rebase, so `--reset` is reserved for genuinely-worthless work, not for escaping self-inflicted stale state.
