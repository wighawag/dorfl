---
title: 'Resolve git on NixOS when the caller's environment has no PATH (probe the NixOS system profiles)'
slug: git-resolution-probes-nixos-system-profiles
blockedBy: []
---

## What to build

`git.ts` resolves `git` against the spawn env's `PATH` unioned with fixed FHS dirs (`SYSTEM_PATH_DIRS`: `/usr/local/bin`, `/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`). On NixOS none of those holds git (it lives under `/run/current-system/sw/bin` and the Nix store), so every call made with an env that has no usable `PATH` fails with `failed to spawn 'git': not found`. dorfl's own test suite does exactly that (`resolveRepoConfig({env: {}})` and similar): about 70 tests in 12 files failed on a clean `main` on telemaque until the host got a `/usr/bin/git` symlink (observations `config-tests-fail-on-nixos-git-outside-curated-path`, `tests-with-system-only-path-fail-when-git-lives-in-nix-store-2026-09-27`). `DORFL_GIT` did not help, because those tests replace the whole env.

Add the standard NixOS locations to the fallback probe (at least `/run/current-system/sw/bin` and `/nix/var/nix/profiles/default/bin`, appended after the FHS dirs so a caller's own `PATH` and the FHS dirs still win), keeping the per-PATH cache and the existing precedence. Consider whether the tests that pass `env: {}` should instead inherit `PATH`, and record the choice.

## Acceptance criteria

- [ ] On a host whose git exists only under `/run/current-system/sw/bin`, a spawn with an env lacking `PATH` resolves git (tested with a fake bin dir via the probe list seam).
- [ ] The precedence is unchanged: `DORFL_GIT` / `GIT`, then the env's own `PATH`, then the fallback dirs (existing tests stay green).
- [ ] The two observation notes named above are updated or marked resolved.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: make dorfl's git resolution work on NixOS without host workarounds. Read `SYSTEM_PATH_DIRS`, `pathWithSystemDirs`, `resolveGitBinary` and `spawnErrorMessage` in `packages/dorfl/src/git.ts`, the finding `git-spawn-enoent-under-caller-path-missing-usr-bin-2026-07-23`, and the observations named in the task body.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **Added only the two NixOS system-wide profiles.** Chosen: `/run/current-system/sw/bin` and `/nix/var/nix/profiles/default/bin`, as the task asked. Not added: per-user profiles (`~/.nix-profile/bin`, `/etc/profiles/per-user/$USER/bin`). They depend on `HOME`/`USER`, which an empty env doesn't have, and reading them from the OS would make lookup depend on who runs dorfl. So a git that exists only in a user profile, or only in a `nix-shell`, still needs `DORFL_GIT` or a caller `PATH`. I noted this in the second observation. This touches only `git.ts` resolution.
- **The NixOS dirs also go on the spawn `PATH`, not just the git lookup.** This lets git's own hooks, `ssh` and `sh` resolve on NixOS too, the same way the FHS dirs already work. The alternative was probing them only for the git binary. The visible effect is that the "Effective PATH=" line in the not-found error now always ends with these two dirs on every host. On non-NixOS hosts they don't exist and are harmless.
- **Left the `env: {}` tests as they are.** I didn't make them inherit `PATH`. An empty env is exactly the situation the product must handle, so those tests now cover the fix on NixOS rather than being worked around. Making them inherit `PATH` would hide exactly the problem this task fixes. This touches the roughly 12 test files named in the observations; none were edited.
