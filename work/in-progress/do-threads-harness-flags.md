---
title: do silently ignores --harness/--agent-cmd/--pi-bin/--model — thread them into config
slug: do-threads-harness-flags
blockedBy: [do-in-place]
covers: []
---

## What to build

> Self-contained bug fix \u2014 derives from NO PRD (`covers: []`), so per
> WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Spotted in live
> use: `agent-runner do --watch <slug> --harness pi` errored
> `no agentCmd configured` despite `--harness pi`.

The `do` command **declares** `--harness`, `--agent-cmd`, `--pi-bin`, and
`--model` options (and `DoFlags` captures them), but its action **never threads
them into the resolved config** \u2014 it passes only `{integration}` to
`resolveRepoConfig`:

```ts
const resolved = resolveRepoConfig({
  repoPath: cwd,
  global,
  flags: flagMode ? {integration: flagMode} : {},  // ← harness/agentCmd/piBin/model DROPPED
});
```

So `config.harness` falls back to the file/default (unset \u2192 null adapter), the CLI
`--harness pi` is **silently ignored**, and the null-adapter guard then demands an
`agentCmd` that the user never needed (they asked for pi). Silent-ignore-of-a-flag
is the worst failure mode \u2014 it LOOKS wired but isn't.

**The fix:** thread the `do` CLI flags into the resolved config, exactly as `run`
already does. `run` builds a `PartialConfig` of overrides via `runFlagOverrides`
(folds in `harness`/`agentCmd`/`piBin`/`model`/`integration`/\u2026); the `do` action
must do the equivalent \u2014 pass those flag overrides into `resolveRepoConfig`'s
`flags` (NOT just `integration`), so the precedence chain (flag > env > per-repo >
global > default) holds for `do` like it does for `run`/`complete`.

- Reuse / mirror the existing override-building (`runFlagOverrides` or the
  per-key mapping it does); do NOT invent a parallel mechanism.
- Honour the same host-only / per-repo rules `resolveRepoConfig` already enforces
  (`piBin`/`agentCmd` are host-only, etc.) \u2014 passing them as FLAGS is a legitimate
  per-machine source, same as `run`.
- After the fix, `agent-runner do --harness pi <slug>` resolves `config.harness ===
  'pi'` and does NOT require `agentCmd`; `--agent-cmd`/`--pi-bin`/`--model` likewise
  take effect.

## Acceptance criteria

- [ ] `do --harness pi <slug>` resolves the pi adapter (no `agentCmd` demanded);
      `do --harness null --agent-cmd '<cmd>' <slug>` resolves the null adapter with
      that command; `--pi-bin` and `--model` flags take effect.
- [ ] The flags fold through the SAME precedence chain `run`/`complete` use
      (flag > env > per-repo > global > default); the `do` action reuses the
      existing override-builder (e.g. `runFlagOverrides`), not a new one.
- [ ] No regression: a `do` run with NO harness flags + NO config still hits the
      existing "no agentCmd configured" guard (null adapter, empty agentCmd).
- [ ] Tests (vitest): `--harness pi` makes `do` resolve pi (asserted via the
      resolved config / a stubbed harness selection), and the null-default guard
      still fires when nothing is configured.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `do-in-place` \u2014 the bug is in the `do` command this slice shipped (in `done/`).
  Build on it.

## Prompt

> Fix a `do` config-resolution bug spotted live: `do` declares `--harness`,
> `--agent-cmd`, `--pi-bin`, `--model` but its action SILENTLY IGNORES them \u2014 it
> passes only `{integration}` to `resolveRepoConfig`, so `--harness pi` is dropped
> and `do` wrongly demands `agentCmd`.
>
> READ FIRST: `src/cli.ts` \u2014 the `do` command action (the `resolveRepoConfig({...,
> flags: flagMode ? {integration: flagMode} : {}})` call that drops the other
> flags; the null-adapter guard `config.harness !== 'pi' && config.agentCmd.trim()
> === ''`), AND the `run` command + `runFlagOverrides` (the CORRECT pattern that
> folds harness/agentCmd/piBin/model/integration into a `PartialConfig`).
> `src/repo-config.ts` (`resolveRepoConfig` precedence + host-only rules) and
> `src/env-config.ts`.
>
> Thread the `do` flags into `resolveRepoConfig`'s `flags` (reuse `runFlagOverrides`
> or its per-key mapping; do NOT invent a parallel path), so flag > env > per-repo >
> global > default holds for `do` as for `run`. Keep the host-only/per-repo rules.
>
> TDD with vitest, house style: `do --harness pi` resolves pi (no agentCmd
> demanded); `--agent-cmd`/`--pi-bin`/`--model` take effect; the no-config null-
> default guard still fires. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim do-threads-harness-flags --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/do-threads-harness-flags <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/do-threads-harness-flags.md work/done/do-threads-harness-flags.md
```

## Needs attention

acceptance gate failed (exit 1)
