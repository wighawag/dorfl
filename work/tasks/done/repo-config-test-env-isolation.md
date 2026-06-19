---
title: isolate resolveRepoConfig tests from ambient AGENT_RUNNER_* env (inject env:{}) so they pass on any machine
slug: repo-config-test-env-isolation
blockedBy: []
covers: []
---

## What to build

> Self-contained test-hygiene fix — derives from NO PRD (`covers: []`), so it omits `prd:` and is its own source of truth. From `work/observations/repo-config-tests-read-ambient-env.md`.

Several `test/repo-config.test.ts` cases call `resolveRepoConfig({repoPath, global})` WITHOUT injecting `env:`, so they fall through to the real `process.env`. The env layer (`flag > ENV (AGENT_RUNNER_*) > per-repo > global > default`) then leaks any exported `AGENT_RUNNER_*` var into the resolved config and breaks assertions like `expect(resolved.config).toEqual(DEFAULT_CONFIG)`.

Observed live: with `AGENT_RUNNER_HARNESS=pi` exported in the runner's shell, two such tests fail spuriously (`harness: "pi"` leaks into the expected default). The suite is green only in a clean env (`env -u AGENT_RUNNER_HARNESS pnpm -r test`). So the test suite is **machine-dependent** — a developer or CI with ANY `AGENT_RUNNER_*` exported gets red tests for no real reason.

Fix: the same isolation pattern the `model-config` + `do-config` tests already use — **inject `env: {}`** into every `resolveRepoConfig` (and any sibling) call whose assertion depends on the absence of env overrides. This pins the env layer to empty so the test asserts the intended `DEFAULT_CONFIG`/`global` result regardless of the ambient shell.

- The known-affected assertions are the `toEqual(DEFAULT_CONFIG)` / `toEqual(global)` cases that currently omit `env:` (e.g. the "no file and a bare global keeps the built-in defaults" case around `repo-config.test.ts:164`). One sibling case already injects `env: {}` (≈ line 392) — mirror it.
- Audit the WHOLE file for any other env-fall-through assertion, not only the two observed (the leak depends on which `AGENT_RUNNER_*` happens to be exported, so a different exported var could expose a different case).
- Pure test change — NO production code change. Do not alter the resolution chain (the env-reads-process.env behaviour is correct and intentional; only the TESTS must pin it).

## Acceptance criteria

- [ ] Every `resolveRepoConfig` test assertion that depends on the absence of env overrides injects `env: {}` (or an explicit map), so it no longer reads the ambient `process.env`.
- [ ] `pnpm -r test` passes with an `AGENT_RUNNER_*` var exported in the shell (e.g. `AGENT_RUNNER_HARNESS=pi pnpm -r test`) AND in a clean env — i.e. the suite is machine-independent. (A test or a documented manual check proves the previously-leaking case now passes under an exported var.)
- [ ] No production code changed; the env resolution chain is untouched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — a self-contained test-only edit.

## Prompt

> `test/repo-config.test.ts` has `resolveRepoConfig` cases that omit `env:` and so read the real `process.env`; an exported `AGENT_RUNNER_*` var (e.g. `AGENT_RUNNER_HARNESS=pi`) leaks into the resolved config and breaks `toEqual(DEFAULT_CONFIG)`/`toEqual(global)` assertions — the suite is machine-dependent. Fix by injecting `env: {}` into every such assertion (the pattern `model-config`/`do-config` tests already use), so the env layer is pinned empty and the suite passes regardless of the ambient shell.
>
> READ FIRST: `work/observations/repo-config-tests-read-ambient-env.md` (the live report); `test/repo-config.test.ts` (the cases — note one ≈L392 already injects `env: {}`, mirror it; the leaking one is ≈L164); `src/repo-config.ts` (`resolveRepoConfig` + the `flag > ENV > per-repo > global > default` chain — do NOT change it, the env-reads-process.env behaviour is correct). AUDIT the whole test file, not just the two observed cases.
>
> Pure test change. Verify with BOTH `AGENT_RUNNER_HARNESS=pi pnpm -r test` and a clean `pnpm -r test`. "Done" = acceptance criteria met and the gate green under an exported `AGENT_RUNNER_*` var.

---

### Claiming this slice

```sh
agent-runner claim repo-config-test-env-isolation --arbiter <remote>
git fetch <remote> && git switch -c work/repo-config-test-env-isolation <remote>/main
git mv work/in-progress/repo-config-test-env-isolation.md work/done/repo-config-test-env-isolation.md
```
