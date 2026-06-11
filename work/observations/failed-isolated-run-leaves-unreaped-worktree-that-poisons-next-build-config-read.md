---
title: a FAILED `do --isolated`/`--remote` run leaves an un-reaped job worktree whose checked-out `work/<slug>` branch BLOCKS the mirror's `git fetch --prune` — silently breaking the per-repo-config read on the NEXT build (→ "no agentCmd"), and `gc` (safe) is too conservative to clear it
date: 2026-06-11
status: open
---

## The signal

Driving the backlog with `do --isolated`, a build (`advance-drivers-and-gates`) failed its gate (a flake) AND then its needs-attention push was rejected (non-fast-forward) — so the run aborted WITHOUT reaping its job worktree. The next `do --isolated` (a different slice) then failed up-front with:

```
>> could not read the target repo's .agent-runner.json from git@github.com:…/main; resolving config from global + flags only.
   git fetch --prune origin +refs/heads/*:refs/heads/* failed (exit 128):
   fatal: refusing to fetch into branch 'refs/heads/work/slice-advance-drivers-and-gates' checked out at
   '/home/wighawag/.agent-runner/work/…__advance-drivers-and-gates'
error: no agentCmd configured — set `agentCmd` in config or pass --agent-cmd.
```

Two failures chained:

1. The per-repo-config read (`remote-do-reads-per-repo-config-from-arbiter-main`, #71) does a `git fetch --prune origin +refs/heads/*:refs/heads/*` against the bare mirror to refresh `main` before `git show main:.agent-runner.json`. That refspec fetches ALL heads — including `work/slice-<other-slug>` — and git REFUSES to fetch into a branch that is CHECKED OUT in a (stale) worktree. So the fetch fails, the config read fails, and it falls back to global+default.
2. The fallback drops `harness: pi` → the null adapter → `no agentCmd configured`. So a STALE worktree from a previous FAILED run silently breaks the harness resolution of EVERY subsequent `--isolated`/`--remote` build — a cross-build contamination.

## Why the worktree was left

The run aborted on the needs-attention PUSH rejection (non-fast-forward), AFTER the gate red, BEFORE the reap. Auto-reap only runs on the clean end-of-job path; an abort mid-surface skips it. So the job worktree (with its checked-out `work/<slug>` branch) lingers in `workspacesDir/work/`.

## Why `gc` (safe) did not clear it

`agent-runner gc` (no `--force`) retained BOTH stale worktrees:

```
>> Retained advance-drivers-and-gates: branch not pushed (remote tip differs from local tip).
>> Retained advance-verb-resolver: dirty tree (uncommitted changes).
```

The safe predicate (clean tree AND branch tip reachable on arbiter) is correctly conservative — but here BOTH worktrees' real work WAS safe on the arbiter (one merged via its PR, the other's branch preserved on origin + parked in needs-attention), they just had local doc-churn / uncommitted bits that tripped the predicate. So `gc` could not auto-clear the very worktrees that were poisoning subsequent builds; only `gc --force --yes` did (after manually verifying the work was on origin).

## The fix(es)

1. **Reap on the FAILURE/abort path too** — the needs-attention surfacing (and any abort after claim) must ALSO reap (or at least `git worktree remove`) the job worktree, not only the clean-completion path. A worktree must never outlive its run.
2. **Make the config-read fetch NOT use the all-heads refspec** — `git show main:.agent-runner.json` only needs `main`. Fetch ONLY `+refs/heads/main:refs/remotes/origin/main` (or `git fetch origin main`) instead of `+refs/heads/*:refs/heads/*`, so a checked-out `work/<slug>` branch in some other worktree can never block it. (The all-heads fetch is also wasteful.) This removes the cross-build coupling at the root.
3. **`gc` could offer a `--reachable-only` / smarter mode** that reaps a worktree whose BRANCH is reachable on the arbiter even if the local tree has incidental uncommitted churn — distinguishing "the durable work is on the arbiter" from "there is unsaved work". (Lower priority; #1+#2 are the real fixes.)

Either #1 or #2 alone would have prevented the contamination; both are worth doing (defence in depth: never leak a worktree; never let a leaked one block config resolution).

## Where

The needs-attention/abort path in `src/do.ts` `performDoRemote` (must reap on failure, not only on clean completion); the per-repo-config fetch in the #71 read path (`src/repo-mirror.ts` / the `resolveRemoteRepoConfig` fetch — narrow the refspec to `main` only); `src/gc.ts` (the safe-predicate conservatism). Cross-ref: `remote-do-reads-per-repo-config-from-arbiter-main` (done, #71 — its fetch is the one to narrow), `job-worktree-artifact-agent-runner-job-json-leaks-into-commits.md`, `requeue-and-recovery-assume-local-checkout-no-remote-arbiter-form.md`.
