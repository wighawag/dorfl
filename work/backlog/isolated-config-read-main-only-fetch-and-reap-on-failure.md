---
title: isolated-config-read-main-only-fetch-and-reap-on-failure — stop a stale job worktree from poisoning the NEXT `do --isolated`/`--remote` build by (1) routing the build-path per-repo-config read through the main-only no-prune `fetchMirrorMain` (NOT `ensureMirror`'s all-heads pruning fetch, which a checked-out `work/<slug>` worktree branch BLOCKS), and (2) reaping the job worktree on the FAILURE/abort path, not only on clean completion
slug: isolated-config-read-main-only-fetch-and-reap-on-failure
blockedBy: []
covers: []
---

> Self-contained ROBUSTNESS-FIX slice — derives from NO PRD (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Source signal (discharged into this slice on authoring): `work/observations/failed-isolated-run-leaves-unreaped-worktree-that-poisons-next-build-config-read.md` (2026-06-11), observed live across a drive-backlog session.
>
> PARTIAL-LANDING NOTE: fix #2 below ALREADY landed for the READ paths (`scan`/`status`/mirror-pool-scan) — `fetchMirrorMain` + `resolveRepoConfigFromMirror` exist and are main-only/no-prune. This slice EXTENDS that same fix to the `--remote`/`--isolated` BUILD-path config read, which still goes through `ensureMirror`'s all-heads pruning fetch and so is NOT fixed on the path the contamination actually occurred on.

## The defect (verify against current code before fixing)

Driving the backlog with `do --isolated`, a build that FAILED its gate AND then had its needs-attention push rejected aborted WITHOUT reaping its job worktree. The next `do --isolated` (a DIFFERENT slice) then failed up-front:

```
>> could not read the target repo's .agent-runner.json from <arbiter>/main; resolving config from global + flags only.
   git fetch --prune origin +refs/heads/*:refs/heads/* failed (exit 128):
   fatal: refusing to fetch into branch 'refs/heads/work/slice-<other-slug>' checked out at
   '<workspacesDir>/work/…__<other-slug>'
error: no agentCmd configured — set `agentCmd` in config or pass --agent-cmd.
```

Two failures chained:

1. **The build-path per-repo-config read does an ALL-HEADS pruning fetch that a checked-out worktree branch blocks.** Verify: `src/cli.ts` `resolveRemoteRepoConfig` (~L185-223) — the per-repo config resolution for `do --remote`/`do --isolated` — calls `ensureMirror({url: remote, …})` (~L198) to refresh the mirror before `readRepoConfigFromMirrorMain`. `ensureMirror` (`src/repo-mirror.ts` ~L142) fetches with `+refs/heads/*:refs/heads/*` (ALL heads, with `--prune`). That refspec tries to fetch `work/slice-<other-slug>` too, and git REFUSES to fetch into a branch that is CHECKED OUT in a (stale) worktree (`fatal: refusing to fetch into branch … checked out at …`). So the fetch throws, the config read's `catch` (~L209) falls back to global+default, and `harness: pi` is dropped → the null adapter → `no agentCmd configured`. A STALE worktree from a PREVIOUS failed run silently breaks harness resolution for EVERY subsequent `--isolated`/`--remote` build (cross-build contamination).

2. **The job worktree was left un-reaped because the run aborted on the FAILURE path.** Verify: `src/do.ts` `performDoRemote` reaps in a `finally` via the strategy handle (~L1490-1497), but with the CONSERVATIVE reap predicate (clean tree AND branch tip reachable on arbiter — same as `gc`'s §4 predicate). When the run aborts mid-surface (the needs-attention push was rejected non-fast-forward, AFTER the gate red, BEFORE a clean teardown), OR when the worktree has incidental local doc-churn / uncommitted bits, the predicate RETAINS the worktree (`>> Retained <slug>: dirty tree …` / `branch not pushed …`) even though the durable work IS safe on the arbiter. So `gc` (safe, no `--force`) cannot auto-clear the very worktree that is poisoning subsequent builds; only `gc --force --yes` did, after manually verifying the work was on origin. A worktree must never outlive its run in a state that breaks the next one.

`fetchMirrorMain` (`src/repo-mirror.ts` ~L185-200) ALREADY exists and is exactly the main-only, NO-prune fetch the READ paths use (`resolveRepoConfigFromMirror` ~L253, the registry `scan`/`status` fetch-first) precisely to avoid pruning/blocking on live worktrees' `work/<slug>` branches — its docstring cites this failure mode (ADR §6). The build-path read just doesn't use it yet.

## What to build

A PRESCRIPTIVE two-part fix (either part alone would have prevented the observed contamination; do BOTH — defence in depth: never leak a worktree, AND never let a leaked one block config resolution).

1. **Route the build-path per-repo-config read through a main-only, NO-prune fetch — NOT `ensureMirror`'s all-heads pruning fetch.** In `src/cli.ts` `resolveRemoteRepoConfig`, stop calling `ensureMirror` for the config read. `git show main:.agent-runner.json` only needs `main`. Either reuse the existing `resolveRepoConfigFromMirror` (`src/repo-mirror.ts`, which reads via `readRepoConfigFromMirrorMain` and is the read-path's main-only helper) for the build path too, or refresh the mirror's `main` via `fetchMirrorMain` (main-only, no-prune) before `readRepoConfigFromMirrorMain`. The constraint: the config-read fetch must NEVER use `+refs/heads/*:refs/heads/*` (the all-heads prune), so a `work/<slug>` branch checked out in some OTHER worktree can never block it. Keep the existing resilient `catch` (offline arbiter / corrupt mirror → warn + fall back to global+default) — only the fetch refspec changes.

   - **Subtlety to handle:** the build itself (NOT the config read) still legitimately calls `ensureMirror` later to MATERIALISE the job worktree (it needs the kept `work/<slug>` head for continue-detection — see `src/workspace.ts` ~L213, which depends on the all-heads fetch landing `work/<slug>` as a local head). Do NOT break that. Scope the change to the CONFIG-READ fetch only (decouple "read main:.agent-runner.json" from "materialise the worktree"); the worktree-materialisation fetch is a separate concern and out of scope here. If a stale checked-out branch ALSO blocks the materialisation fetch, that is fix-by-reap (#2), not this refspec change — so #2 is what protects the materialise path.

2. **Reap the job worktree on the FAILURE/abort path, not only on clean completion.** In `src/do.ts` `performDoRemote`, ensure the needs-attention surfacing path (and any abort after claim) ALSO reaps (or at minimum `git worktree remove`s) the job worktree, so a failed run never leaves a worktree whose checked-out branch blocks later fetches. The DURABLE work is already preserved on the arbiter (the branch is pushed / the item is surfaced to needs-attention) BEFORE the reap — reaping the worktree does NOT lose work; it removes only the local checkout. Distinguish "the durable work is on the arbiter" (safe to remove the worktree) from "there is genuinely-unsaved local work" (retain): on the failure path, once the branch is confirmed pushed / the item surfaced, the worktree is reapable even if its tree has incidental churn (the churn is not the durable artifact). Do NOT reap a worktree whose real work is NOT yet on the arbiter.

   - Prefer fixing the predicate/seam at the reap site (`src/do.ts` ~L1490-1497 strategy teardown + whatever the failure/abort branch does) so the FAILURE path's teardown reaps once the work is provably on the arbiter, rather than inheriting `gc`'s most-conservative "clean tree AND reachable" predicate verbatim. The reachable-on-arbiter half is the safety condition that must hold; the clean-tree half should NOT block reaping a worktree whose durable branch is already pushed.

3. **(Lower priority — include only if cheap) a `gc` "reachable-only" affordance.** Optionally let `gc` reap a worktree whose BRANCH is reachable on the arbiter even if the local tree has incidental uncommitted churn — distinguishing "durable work is on the arbiter" from "unsaved work". `#1`+`#2` are the real fixes; this is a nicety so a human `gc` can clear a churn-dirty-but-safe worktree without `--force`. If it adds meaningful surface, defer it to its own slice and note that here rather than expanding this one.

## Scope

- IN: route the `do --remote`/`do --isolated` CONFIG-READ fetch (`cli.ts resolveRemoteRepoConfig`) through a main-only no-prune fetch (reuse `resolveRepoConfigFromMirror`/`fetchMirrorMain`), so a checked-out worktree branch can never block it; reap the job worktree on the FAILURE/abort path in `do.ts performDoRemote` once the durable work is provably on the arbiter.
- OUT: changing the worktree-MATERIALISATION fetch (`ensureMirror`'s all-heads fetch that `workspace.ts` continue-detection depends on) — that legitimately needs all heads; reaping a worktree whose work is NOT yet on the arbiter (never lose work); a full `gc` predicate redesign (the optional reachable-only mode is deferrable to its own slice); the per-repo-config read's resilient-fallback behaviour (keep it).

## Acceptance criteria

- [ ] The `do --remote`/`do --isolated` per-repo-config read NO LONGER uses the all-heads pruning fetch (`+refs/heads/*:refs/heads/*`). It refreshes only `main` (via `resolveRepoConfigFromMirror`/`fetchMirrorMain` or an equivalent main-only no-prune fetch) before reading `main:.agent-runner.json`. A test reproduces the original failure shape — a stale worktree with a checked-out `work/<other-slug>` branch present in the mirror — and asserts the config read SUCCEEDS (resolves the per-repo `harness`/`verify`/etc.) instead of failing with the "refusing to fetch into branch … checked out" error and falling back to global+default.
- [ ] The resilient fallback is preserved: a genuine fetch/read fault (offline arbiter / corrupt mirror) still WARNS and falls back to global+default rather than throwing (the existing `catch` behaviour is unchanged for real faults).
- [ ] The worktree-materialisation path (continue-detection in `workspace.ts`, which needs the kept `work/<slug>` head) is NOT broken by the config-read change (it still gets the heads it needs; only the config-read fetch was narrowed). Verified by the existing continue/requeue tests staying green.
- [ ] On a FAILED/aborted `do --remote`/`do --isolated` run (gate red + needs-attention surface, OR an abort after claim), the job worktree is REAPED (or `git worktree remove`d) once the durable work is provably on the arbiter — it does NOT linger to block the next build's fetch. A test drives a failure path and asserts the job worktree directory is gone (or removed) afterward, while the branch/needs-attention item remains safe on the arbiter.
- [ ] Reaping on failure NEVER loses work: a worktree whose real work is NOT yet on the arbiter is RETAINED (the test covers both — pushed ⇒ reaped, genuinely-unsaved ⇒ retained).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. The read-path half of fix #2 already landed (`fetchMirrorMain`/`resolveRepoConfigFromMirror` in `src/repo-mirror.ts`); this slice reuses those primitives for the build path and adds the failure-path reap. No in-flight slice blocks it.

## Prompt

> Stop a stale job worktree from POISONING the next `do --isolated`/`--remote` build. Two chained defects (verify against current code first): (1) the build-path per-repo-config read (`src/cli.ts` `resolveRemoteRepoConfig` ~L185-223) calls `ensureMirror` (~L198), which fetches ALL heads with prune (`+refs/heads/*:refs/heads/*`, `src/repo-mirror.ts` ~L142); git REFUSES to fetch into a `work/<slug>` branch that is CHECKED OUT in a stale worktree, so the config read throws, falls back to global+default, drops `harness: pi`, and the next build dies with "no agentCmd configured". (2) The job worktree was left un-reaped because the run aborted on the FAILURE path (gate red + needs-attention push rejected, before a clean teardown) and the conservative reap predicate (`src/do.ts` `performDoRemote` ~L1490-1497, clean-tree AND reachable) RETAINS a churn-dirty-but-arbiter-safe worktree.
>
> THE FIX (prescriptive, do BOTH): (1) route the CONFIG-READ fetch through a main-only, NO-prune fetch — reuse `resolveRepoConfigFromMirror` / `fetchMirrorMain` (`src/repo-mirror.ts` ~L185-200/L253, which the READ paths `scan`/`status`/mirror-pool-scan already use precisely to avoid pruning live worktrees' branches, ADR §6) for the build path too, so `git show main:.agent-runner.json` never needs an all-heads fetch and a checked-out worktree branch can never block it. Keep the resilient `catch` (offline/corrupt ⇒ warn + global+default). Do NOT touch the worktree-MATERIALISATION fetch (`workspace.ts` ~L213 continue-detection legitimately needs all heads) — scope the change to the config read only. (2) reap the job worktree on the FAILURE/abort path in `performDoRemote` once the durable work is provably on the arbiter (branch pushed / item surfaced), so a failed run never leaves a worktree that blocks the next fetch — but NEVER reap a worktree whose work is not yet on the arbiter (never lose work).
>
> READ FIRST: `src/cli.ts` `resolveRemoteRepoConfig` (~L185-223 — the build-path config read calling `ensureMirror`); `src/repo-mirror.ts` `ensureMirror` (~L142, the all-heads prune fetch), `fetchMirrorMain` (~L185-200, the main-only no-prune helper), `resolveRepoConfigFromMirror` (~L253, the read-path consumer), `readRepoConfigFromMirrorMain` (the `git show main:.agent-runner.json` reader); `src/do.ts` `performDoRemote` (the reap-in-finally ~L1490-1497 + the needs-attention/abort branch ~L1555-1588); `src/workspace.ts` (~L213, the continue-detection that depends on the materialisation all-heads fetch — must stay working); `src/gc.ts` (the §4 clean-AND-reachable predicate the reap should NOT inherit verbatim on the failure path). Source signal: `work/observations/failed-isolated-run-leaves-unreaped-worktree-that-poisons-next-build-config-read.md`. Cross-ref: `work/done/remote-do-reads-per-repo-config-from-arbiter-main.md` (#71, whose fetch this narrows for the build path), `work/observations/job-worktree-artifact-agent-runner-job-json-leaks-into-commits.md`.
>
> TEST: reproduce the original shape — a stale worktree with a checked-out `work/<other-slug>` branch in the mirror — and assert the config read SUCCEEDS (resolves per-repo `harness`/`verify`) instead of failing-into-global+default. Assert the resilient fallback still fires for a REAL fault. Drive a failure path and assert the job worktree is reaped when the branch is on the arbiter, and RETAINED when the work is genuinely unsaved (never lose work). Keep continue/requeue tests green (the materialisation fetch is untouched).
>
> SCOPE FENCE: do NOT change the worktree-materialisation all-heads fetch; do NOT reap a worktree whose work is not yet on the arbiter; keep the offline/corrupt resilient fallback. "Done" = the build-path config read uses a main-only no-prune fetch (a checked-out worktree branch can't block it), failed runs reap their worktree once work is safe on the arbiter, no work is ever lost, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

---

### Claiming this slice

```sh
agent-runner claim isolated-config-read-main-only-fetch-and-reap-on-failure --arbiter origin
git fetch origin && git switch -c work/isolated-config-read-main-only-fetch-and-reap-on-failure origin/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/isolated-config-read-main-only-fetch-and-reap-on-failure.md work/done/isolated-config-read-main-only-fetch-and-reap-on-failure.md
```
