---
title: main-divergence guard + non-fatal local-main sync for in-place do/complete --merge
slug: main-divergence-guard
blockedBy: [do-in-place]
covers: []
---

## What to build

> Self-contained fix \u2014 derives from NO SPEC (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Spotted live on `do-in-place`'s first `--merge` run: `work/observations/in-place-do-complete-needs-main-divergence- guard.md` (delete that note once this lands).

A **two-part fix** for the in-place `do` / human `complete --merge` path, both needed:

### Part 1 \u2014 the local-main sync (the convenience step) MUST be NON-FATAL

This is the load-bearing part. In `complete` merge mode, after the work is pushed to `<arbiter>/main` (the AUTHORITATIVE, safety-bearing step), `complete` calls `syncLocalMain(...)` (`src/complete.ts`) to switch to local `main` and `git merge --ff-only <arbiter>/main` it forward. **Today that ff is a `gitHard` call \u2014 if it can't fast-forward (local `main` diverged), it THROWS and the whole `complete` exits non-zero \u2014 even though the merge ALREADY SUCCEEDED on the arbiter.** The exit code lies: a cosmetic follow-on fails the command, making an operator/CI think the work did not land.

- Make `syncLocalMain`'s ff **non-fatal**: on ff failure, print a clear MESSAGE ("work landed on `<arbiter>/main`; your local `main` couldn't fast-forward (it has diverged) \u2014 run `git rebase origin/main` to sync") and **continue / succeed** (the command's success is defined by the authoritative arbiter push, NOT the local-sync courtesy).
- Do NOT mask a genuinely different failure: only the ff-cannot-apply / diverged-`main` case becomes non-fatal. The completion result should still report it (e.g. a `localMainSynced: false` / message) so callers know the local sync was skipped \u2014 but `outcome` stays `completed` and exit code stays 0.

### Part 2 \u2014 a pre-flight DIVERGENCE GUARD (sibling to the dirty-tree refusal)

`do` (in-place) already REFUSES on a dirty working tree. A diverged/unpushed local `main` is the same class of "checkout state that breaks the in-place flow" \u2014 guard it the SAME way, BEFORE the agent runs (so a whole build isn't wasted):

- Before onboarding, compare local `main` to `<arbiter>/main` (fetch first, as the flow already does). If local `main` is AHEAD/diverged (has commits the arbiter lacks \u2014 unpushed work; `git rev-list <arbiter>/main..main` non-empty), **refuse** with a clear message: "local `main` is ahead of `<arbiter>/main` by N commits (unpushed); the slice builds off `<arbiter>/main` and the merge-back can't fast-forward \u2014 push or reconcile `main` first."
- **Override:** an `--ignore-...`-style flag (mirror the `--ignore-not-ready` readiness-override pattern in `cli.ts`) to proceed anyway. When overridden and the divergence persists, Part 1's non-fatal sync handles the outcome honestly.

### Scope

- Applies to the **in-place** paths that ff local `main`: in-place `do` and human `complete --merge`.
- Does NOT apply to `do --remote` / `run` \u2014 they work in job WORKTREES off a hub mirror and never touch the operator's local `main` (immune by construction). Do not add the guard there.

## Acceptance criteria

- [ ] `complete --merge`'s local-`main` ff is NON-FATAL: when local `main` can't fast-forward, `complete` prints a "rebase to sync" message and STILL returns `outcome: completed`, exit 0 (the arbiter push already defined success); the result records the local sync was skipped (e.g. `localMainSynced: false`).
- [ ] A genuinely different failure in the sync path is NOT masked (only diverged/ff-cannot-apply becomes non-fatal).
- [ ] In-place `do` (and `complete --merge`) REFUSE up front when local `main` is diverged/ahead of `<arbiter>/main`, with a clear message, UNLESS the `--ignore-...` override is passed.
- [ ] Tests (throwaway repos + local `--bare` arbiter): (a) a diverged local `main` \u2192 `do` refuses before running the agent; (b) with `--ignore`, it proceeds and `complete` finishes exit-0 with the non-fatal sync message (work on the arbiter, local `main` left for the operator to rebase); (c) the normal (non-diverged) path still ff's local `main` exactly as today.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `do-in-place` \u2014 the in-place `do` path + `syncLocalMain` semantics this fixes shipped with the keystone (in `done/`). Build on it.

## Prompt

> Fix the in-place `do` / `complete --merge` main-sync flaw spotted on the keystone's first run (read `work/observations/in-place-do-complete-needs-main- divergence-guard.md` first). TWO parts:
>
> PART 1 (load-bearing): in `src/complete.ts`, `syncLocalMain(...)` does a `gitHard(['merge','--ff-only', '<arbiter>/main'])` after the AUTHORITATIVE push to `<arbiter>/main`. If that ff can't apply (local `main` diverged), it currently THROWS \u2192 `complete` exits non-zero even though the merge SUCCEEDED on the arbiter. Make the ff NON-FATAL: on ff-failure print a "work landed on <arbiter>/main; local main diverged \u2014 run `git rebase origin/main` to sync" message and keep `outcome: completed` / exit 0 (success = the arbiter push, not the local courtesy). Record it on the result (e.g. `localMainSynced: false`). Do NOT mask other failures \u2014 only the diverged/ff-cannot-apply case.
>
> PART 2: add a pre-flight divergence GUARD to in-place `do` (`src/do.ts`, sibling to its dirty-tree refusal) and the `complete --merge` path: after fetching, if `git rev-list <arbiter>/main..main` is non-empty (local `main` has unpushed commits), REFUSE with a clear message, UNLESS an `--ignore-...` override flag is passed (mirror `--ignore-not-ready` in `src/cli.ts`).
>
> READ FIRST: `src/complete.ts` (`syncLocalMain`, the merge-mode ff at ~L424 \u2014 the exact `gitHard` to soften; `CompleteResult` to extend), `src/do.ts` (the dirty-tree refusal `isDirtyTree` to mirror for the divergence guard), `src/cli.ts` (the `do` + `complete` wiring + the `--ignore-not-ready` flag pattern), `src/git.ts` (`gitSoft`/`gitHard`/`runAsync`), and the observation above. SCOPE: in-place only \u2014 do NOT touch `do --remote`/`run` (worktree paths never ff local main).
>
> TDD with vitest, house style (throwaway repos + local `--bare` arbiter): diverged main \u2192 do refuses pre-agent; `--ignore` \u2192 proceeds + completes exit-0 with the non-fatal sync message; normal path ff's as today; a real (non-divergence) sync error is still fatal. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim main-divergence-guard --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/main-divergence-guard <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/main-divergence-guard.md work/done/main-divergence-guard.md
```
