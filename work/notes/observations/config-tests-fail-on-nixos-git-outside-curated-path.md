---
needsAnswers: true
---

# About 70 tests fail on a NixOS host: git is outside the curated spawn PATH

Date: 2026-09-27
Observer: builder of task `ci-split-route-direct-writes-through-seams`.

On a host where git lives only in `/nix/store/...` (telemaque), `pnpm -r test` fails about 70 tests (`repo-config.test.ts`, `git.test.ts`, the `*-config.test.ts` files, part of `review-gate.test.ts`) with `failed to spawn 'git': not found ... Effective PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`, raised from `gitRemoteGetUrl` in `src/repo-config.ts`. Setting `DORFL_GIT` to the absolute git path did not help. The same set fails on an untouched `git archive HEAD` copy, so it is environmental, not a regression; but it means the acceptance gate cannot go green on this machine.
Update 2026-09-27 (continuation attempt): on the same branch, unchanged, `pnpm -r build && pnpm -r test && pnpm format:check` is now fully green on this host, where `/usr/bin/git` now exists. The failing tests pass `env: {}` to `resolveRepoConfig`, so `DORFL_GIT` and the caller's PATH are dropped and only the curated system dirs are searched. That explains why setting `DORFL_GIT` did not help.
