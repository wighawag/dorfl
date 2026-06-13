---
title: observationTriage - replace the autoTriage boolean with a 3-state gate (off | ask | auto), adding the "off = skip observations" state, with a value-migrating deprecation alias
slug: observation-triage-tri-state-gate
blockedBy: []
covers: []
---

> Self-contained ENGINE slice (`covers: []`, no `prd:`, its own source of truth). Source: `work/ideas/observation-triage-tri-state-gate.md` + decision ADR `docs/adr/ci-config-policy-and-gate-family.md`. ENABLES (does not derive from) `work/prd/runner-in-ci.md`, which depends on this gate existing.

## What to build

Replace the `autoTriage` BOOLEAN config gate with a 3-state ENUM gate **`observationTriage`** = `off | ask | auto`, threading it through the full gate-family resolution chain (the SAME 5 points `autoBuild`/`autoSlice`/`autoTriage` already use), and reading it at the observation-triage rung so:

- **`off`**: the triage rung does NOT run for an auto-picked observation (it is dropped from the selection, mirroring how `autoBuild: false` drops the build pool). The NEW state the boolean could not express ("leave my observations alone entirely").
- **`ask`**: surface a promote/keep/delete question for every untriaged observation (the OLD `autoTriage: false` behaviour).
- **`auto`**: auto-dispose ONLY the no-question cases (duplicate ⇒ recommend delete; unambiguous map) and surface a question for judgement calls (the OLD `autoTriage: true` behaviour). Still NEVER auto-deletes a non-duplicate or auto-promotes.

The novelty vs the existing `allowAgents → autoBuild` rename: this alias migrates the VALUE TYPE too (boolean → enum), not just the key name. So the deprecation alias maps `autoTriage: false → observationTriage: ask` and `autoTriage: true → observationTriage: auto` (and the env var `AGENT_RUNNER_AUTO_TRIAGE` likewise), with a deprecation warning. The existing `config-alias.ts` does a pure string→string key rename; this needs a value-mapping variant (extend it, do not fork the warning/message machinery).

The read site is the advance triage rung (it currently reads `context.autoTriage === true`); `off` must short-circuit BEFORE the rung spawns anything (ideally at the selection/eligibility layer so an `off` repo never even classifies an observation as a candidate). Plain `run`/`do` have no triage rung, so the gate is a no-op there (correct). Explicit `advance obs:<slug>` BYPASSES the gate (the gate binds only the auto-pick path, like `do <slug>` vs `autoBuild`).

## Acceptance criteria

- [ ] `observationTriage` is a `Config` field (enum `off|ask|auto`), default `off`, with merge/`PartialConfig` handling, mirroring `autoTriage`'s old wiring.
- [ ] It threads the FULL chain: `repo-config.ts` `REPO_ALLOWED_KEYS` (per-repo `.agent-runner.json`), `env-config.ts` `KEY_COERCIONS` as an ENUM coercion (`{enum: ['off','ask','auto']}`, like `integration`) so `AGENT_RUNNER_OBSERVATION_TRIAGE` works, and a CLI flag on `advance` (+ `run`/`do` as applicable) so `flag > env > per-repo > global > default` resolves. A typo/invalid enum value FAILS LOUDLY naming the offending source (the existing env coercion contract).
- [ ] The advance triage rung honours all three states: `off` ⇒ the observation is NOT auto-picked / the rung does not run (a test asserts an untriaged observation is left untouched, no sidecar, no question); `ask` ⇒ surfaces the promote/keep/delete question for every untriaged observation; `auto` ⇒ auto-disposes the no-question cases (duplicate/map) and surfaces a question for the rest, identical to the old `autoTriage: true`.
- [ ] `autoTriage` keeps working as a DEPRECATED, VALUE-MIGRATING alias: `false → observationTriage: ask`, `true → observationTriage: auto`, in BOTH the committed config (global + per-repo) and the `AGENT_RUNNER_AUTO_TRIAGE` env var, each emitting a deprecation warning naming the source (reuse `aliasDeprecationMessage` wording where possible). The NEW key WINS if both are present.
- [ ] Explicit `advance obs:<slug>` bypasses the gate (runs the rung regardless of `observationTriage`), asserted by a test, mirroring `do <slug>` vs `autoBuild`.
- [ ] The OLD `autoTriage` `Config` field is removed from the live type (it survives ONLY as the alias-mapped input), so no code reads `config.autoTriage` anymore.
- [ ] Tests mirror the repo's vitest style (throwaway git repos, `GIT_CONFIG_GLOBAL=/dev/null`-style isolation, temp workspace dirs). No shared/global location is written outside temp fixtures.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green (this repo's gate).

## Blocked by

- None, can start immediately.

## Prompt

> Replace the `autoTriage` BOOLEAN gate with a 3-state ENUM `observationTriage` = `off | ask | auto`, threading the full gate-family resolution chain and reading it at the advance triage rung. Source: `work/ideas/observation-triage-tri-state-gate.md`; decision: `docs/adr/ci-config-policy-and-gate-family.md`. This ENABLES `work/prd/runner-in-ci.md` (which depends on the gate), but is a self-contained engine change.
>
> FIRST, drift-check against current code: `config.ts` still has `autoTriage: boolean` (default false, `DEFAULT_CONFIG`); `repo-config.ts` `REPO_ALLOWED_KEYS` lists `autoTriage`; `env-config.ts` `KEY_COERCIONS` has `autoTriage: 'boolean'`; `config-alias.ts` `CONFIG_KEY_ALIASES` does a pure key rename (`allowAgents → autoBuild`); the advance triage rung in `advance.ts` reads `context.autoTriage === true` (and `cli.ts` threads `autoTriage: config.autoTriage` into the `AdvanceContext`). If any landed differently, reconcile or route to `needs-attention/`.
>
> DOMAIN: the gate family is `autoBuild`/`autoSlice`/`autoTriage`, each resolved `flag > env > per-repo > global > default`. `autoTriage` gates only the AUTO-DISPOSITION exception, not whether the triage rung runs, which is the naming trap this slice fixes. The 3-state makes the rung honestly off/ask/auto. The two question-surfacing gates are `observationTriage` (this) and `surfaceBlockers` (a sibling slice); they are orthogonal peers. `needs-attention` (a build hit a wall) is separate and ALWAYS on, do NOT touch it.
>
> BUILD: (1) the `Config` enum field + default `off`; (2) the full chain (REPO_ALLOWED_KEYS, an ENUM coercion in env-config like `integration`, a CLI flag); (3) the value-migrating deprecation alias (boolean → enum: `false→ask`, `true→auto`) for committed config AND the env var, reusing the deprecation-message machinery (extend `config-alias.ts` to support a value map, do not fork the warning); (4) the read site at the triage rung honouring all three states, with `off` short-circuiting at the selection/eligibility layer so an `off` repo never classifies an observation as a candidate; (5) keep explicit `advance obs:<slug>` bypassing the gate.
>
> TEST (TDD, vitest, house style): the three states end-to-end (`off` = observation untouched / no sidecar; `ask` = question surfaced; `auto` = duplicate/map auto-disposed + question for the rest); the alias value-migration (both committed + env, with the warning); the explicit-bypass; the enum-coercion loud-failure on a bad value. Isolate all shared/global locations to temp fixtures.
>
> "Done" = `observationTriage` resolves through the full chain, the triage rung honours off/ask/auto, the value-migrating `autoTriage` alias works with a warning, explicit `obs:` bypasses, no code reads `config.autoTriage`, and the gate is green.
