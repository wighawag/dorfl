---
title: hub-mirror-strong-replace-guard — refuse remote add of a second arbiter for an already-registered project by default; --force allows REPLACING a mirror but still FAILS if any worktree has un-pushed work (reuse gc.ts's clean-AND-reachable per-worktree predicate)
slug: hub-mirror-strong-replace-guard
covers: []
---

> Self-contained safety-guard slice \u2014 derives from NO PRD (`covers: []`), omits `prd:`. Source signal (with the DECIDED design): `work/observations/hub-mirror-key-ignores-transport.md` (2026-06-05 update). The CHEAP transport-mismatch guard already landed (`registry-remote`, in `done/`); THIS is the stronger project-identity guard.

## What to build

The hub-mirror key (`encodeRepoKey`, `src/repo-mirror.ts`) encodes host + path segments (NOT transport) \u2014 correct, and must NOT change (it collapses `ssh`/`https`/`git@` for one GitHub repo onto one mirror). The GAP: switching a project's arbiter between a LOCAL bare repo and its GitHub equivalent (same logical project, different host/path \u2192 different key) silently FORKS the mirror, potentially stranding un-pushed `work/<slug>` work on the old mirror.

The cheap guard (transport-mismatch refusal at `remote add`) landed. Build the STRONG, project-identity guard (the decided design):

- **Block by default:** `remote add` of a second arbiter for an ALREADY-REGISTERED project (same project identity \u2014 the path-tail-under-host, via `projectIdFromKey`) refuses \u2014 not only on transport mismatch, but on project-identity COLLISION.
- **`--force` allows REPLACING** a project's mirror (re-link remote \u2194 `--bare` arbiter deliberately).
- **`--force` STILL FAILS on detectable un-pushed work** on the mirror being replaced \u2014 force overrides the POLICY block, NEVER the DATA-LOSS block.

The data-loss check must use the **FULL per-worktree predicate** (NOT a mirror-refs-only check), because two kinds of un-pushed work live in different homes:

- **committed-but-unpushed** \u2014 in the mirror's object store / `work/*` ref (mirror-side detectable: a `work/*` tip neither merged into `origin/main` nor equal to `origin/<branch>`);
- **uncommitted (dirty worktree)** \u2014 ONLY on disk in the worktree, NO ref, NOT in the mirror \u2014 a mirror-refs check CANNOT see it.

So REUSE `gc.ts`'s existing §4 deletion-safety predicate, which already checks BOTH (1) working tree CLEAN (`git status` INSIDE the worktree) AND (2) branch tip REACHABLE on the arbiter. Enumerate the replaced mirror's worktrees via `discoverJobs(workspacesDir)` (walks `<workspacesDir>/work/*` for `.agent-runner-job.json`, each carrying the mirror key) and/or `git worktree list`, and run the clean-AND-reachable predicate in EACH. `--force` proceeds only when EVERY worktree is provably safe; a single dirty-or-unreachable worktree blocks `--force` with a clear message.

## Acceptance criteria

- [ ] `remote add` of a second arbiter for an already-registered project (same `projectIdFromKey`, different key) is REFUSED by default with a clear message (project-identity collision, not only transport mismatch).
- [ ] `--force` REPLACES the mirror when no worktree has un-pushed work (clean + reachable everywhere).
- [ ] `--force` is REFUSED (data-loss block) when ANY worktree of the replaced mirror is DIRTY (uncommitted) OR has a `work/*` tip not reachable on the arbiter \u2014 using `gc.ts`'s full clean-AND-reachable per-worktree predicate, NOT a mirror-refs-only check. Cover BOTH the dirty-worktree case and the committed-but-unpushed case.
- [ ] `encodeRepoKey` is UNCHANGED (transport still collapsed; the existing key tests still pass).
- [ ] The cheap transport-mismatch guard is not regressed.
- [ ] Tests (throwaway git repos + mirror/worktree fixtures) cover: default block, `--force` clean replace, `--force` dirty-worktree refusal, `--force` unpushed-ref refusal. Mirror `registry`/`gc` test patterns.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None. (Builds on the landed cheap guard + `gc.ts`'s existing predicate.)

## Prompt

> Build the STRONG hub-mirror replace guard per the DECIDED design in `work/observations/hub-mirror-key-ignores-transport.md` (the 2026-06-05 update). The cheap transport-mismatch guard already landed (`registry-remote`); add the project-identity guard + the safe-replace `--force` path.
>
> RULES: (1) `remote add` of a second arbiter for an already-registered project (same `projectIdFromKey`) REFUSES by default. (2) `--force` REPLACES the mirror. (3) `--force` STILL FAILS if un-pushed work is detectable \u2014 force overrides the POLICY block, NEVER the DATA-LOSS block.
>
> CRITICAL \u2014 detection must use the FULL per-worktree predicate, NOT mirror refs alone: committed-but-unpushed work IS in the mirror's refs, but UNCOMMITTED (dirty worktree) work is ONLY on disk and invisible to a refs check. REUSE `gc.ts`'s §4 deletion-safety predicate (working tree CLEAN via `git status` in the worktree AND branch tip REACHABLE on the arbiter). Enumerate the mirror's worktrees with `discoverJobs(workspacesDir)` (walks `<workspacesDir>/work/*` for `.agent-runner-job.json`, each carrying the mirror key) and/or `git worktree list`; `--force` proceeds only if EVERY worktree is clean-AND-reachable.
>
> WHERE TO LOOK (verify paths): `src/repo-mirror.ts` (`encodeRepoKey` \u2014 do NOT change; `ensureMirror`), `src/registry.ts` (`addRemote`, `projectIdFromKey`, the existing transport guard), `src/gc.ts` (the clean-AND-reachable predicate to reuse), the job discovery (`discoverJobs`), `src/cli.ts` (the `remote add --force` wiring). Precedent for "refuse the unsafe thing clearly": `src/arbiter.ts` `assertBare`.
>
> SCOPE FENCE: do NOT encode transport into the key (REJECTED \u2014 it fragments one project's mirror). Do NOT weaken the data-loss block under `--force`.
>
> DRIFT CHECK FIRST: confirm the guard today only refuses on TRANSPORT mismatch (not project-identity collision) and there is no `--force` replace-with-data-loss-check path. If the strong guard already exists, close this slice.
>
> "Done" = default project-identity block, `--force` clean replace, `--force` refusal on any dirty-or-unreachable worktree (full predicate), key unchanged, tests green, and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
