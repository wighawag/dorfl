---
title: observationTriage - replace the autoTriage boolean with a 3-state gate (off | ask | auto), adding the "off = skip observations" state (clean replacement, NO alias)
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

**This is a CLEAN REPLACEMENT, NO deprecation alias.** This repo has no external users yet (decided 2026-06-12), so `autoTriage` is simply DELETED and `observationTriage` takes its place. Do NOT add a `config-alias.ts` entry, do NOT add a value-migrating (boolean→enum) mapping, do NOT keep `AGENT_RUNNER_AUTO_TRIAGE` working. (A value-migrating alias would also have been a TRAP: the env legacy-alias path coerces the OLD var with the NEW key's coercion (`coercionForAlias` → `KEY_COERCIONS[newKey]`), so `AGENT_RUNNER_AUTO_TRIAGE=false` against an enum coercion would THROW "invalid value 'false'". Avoided entirely by not aliasing.) Removing the SEPARATE existing `allowAgents → autoBuild` alias is its own slice (`remove-deprecated-config-aliases`), not this one.

The read site is the advance triage rung in `advance.ts` (it currently reads `context.autoTriage === true`); `off` must short-circuit BEFORE the rung spawns anything (ideally at the selection/eligibility layer so an `off` repo never even classifies an observation as a candidate). NOTE there are TWO threading sites in `cli.ts` that set `autoTriage: config.autoTriage` on the `AdvanceContext` (the single-item path ~L303 and the auto-pick driver path ~L2034); BOTH must be updated to the new field. `autoTriage` has NO CLI flag today (only `--auto-build` exists), so this slice ADDS `--observation-triage <off|ask|auto>` (it is not mirroring an existing flag). Plain `run`/`do` have no triage rung, so the gate is a no-op there (correct). Explicit `advance obs:<slug>` BYPASSES the gate (the gate binds only the auto-pick path, like `do <slug>` vs `autoBuild`).

ALSO (the invariant that resolves the sibling slice's apply question): the two question gates gate the CREATE phase (surface/triage) ONLY. The `apply` rung (consuming a human's committed answer) is ALWAYS allowed and is NOT touched here, an answered observation sidecar still applies even with `observationTriage: off`, so a human's answer is never stranded.

## Acceptance criteria

- [ ] `observationTriage` is a `Config` field (enum `off|ask|auto`), default `off`, with merge/`PartialConfig` handling.
- [ ] It threads the FULL chain: `repo-config.ts` `REPO_ALLOWED_KEYS` (per-repo `.agent-runner.json`), `env-config.ts` `KEY_COERCIONS` as an ENUM coercion (`{enum: ['off','ask','auto']}`, like `integration`) so `AGENT_RUNNER_OBSERVATION_TRIAGE` works, and a NEW CLI flag `--observation-triage <off|ask|auto>` on `advance` (+ `run` as applicable) so `flag > env > per-repo > global > default` resolves. A typo/invalid enum value FAILS LOUDLY naming the offending source (the existing env coercion contract).
- [ ] The advance triage rung honours all three states: `off` ⇒ the observation is NOT auto-picked / the rung does not run (a test asserts an untriaged observation is left untouched, no sidecar, no question); `ask` ⇒ surfaces the promote/keep/delete question for every untriaged observation; `auto` ⇒ auto-disposes the no-question cases (duplicate/map) and surfaces a question for the rest, identical to the old `autoTriage: true`.
- [ ] `autoTriage` is DELETED outright (NO alias): the `Config` field, the `REPO_ALLOWED_KEYS` entry, the `KEY_COERCIONS` entry, and BOTH `cli.ts` threading sites (~L303 single-item, ~L2034 auto-pick driver) are migrated to `observationTriage`. No code reads `config.autoTriage` anymore, and `AGENT_RUNNER_AUTO_TRIAGE` is NOT kept working. (No external users yet, decided 2026-06-12, so no migration window is owed. Removing the separate `allowAgents` alias is `remove-deprecated-config-aliases`, not this slice.)
- [ ] Explicit `advance obs:<slug>` bypasses the gate (runs the rung regardless of `observationTriage`), asserted by a test, mirroring `do <slug>` vs `autoBuild`.
- [ ] The `apply` rung is NOT gated: an already-answered observation sidecar still applies even when `observationTriage: off` (a test asserts a human's committed answer is honoured regardless of the gate, the create-vs-consume invariant). The gate touches the CREATE phase (triage/surface) only.
- [ ] Tests mirror the repo's vitest style (throwaway git repos, `GIT_CONFIG_GLOBAL=/dev/null`-style isolation, temp workspace dirs). No shared/global location is written outside temp fixtures.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green (this repo's gate).

## Blocked by

- None, can start immediately.

## Prompt

> Replace the `autoTriage` BOOLEAN gate with a 3-state ENUM `observationTriage` = `off | ask | auto`, threading the full gate-family resolution chain and reading it at the advance triage rung. Source: `work/ideas/observation-triage-tri-state-gate.md`; decision: `docs/adr/ci-config-policy-and-gate-family.md`. This ENABLES `work/prd/runner-in-ci.md` (which depends on the gate), but is a self-contained engine change.
>
> FIRST, drift-check against current code: `config.ts` still has `autoTriage: boolean` (default false, `DEFAULT_CONFIG`); `repo-config.ts` `REPO_ALLOWED_KEYS` lists `autoTriage`; `env-config.ts` `KEY_COERCIONS` has `autoTriage: 'boolean'`; the advance triage rung in `advance.ts` reads `context.autoTriage === true`; and `cli.ts` threads `autoTriage: config.autoTriage` into the `AdvanceContext` in TWO places (~L303 single-item, ~L2034 auto-pick driver). There is NO `--auto-triage` CLI flag (only `--auto-build`). If any landed differently, reconcile or route to `needs-attention/`.
>
> DOMAIN: the gate family is `autoBuild`/`autoSlice`/`autoTriage`, each resolved `flag > env > per-repo > global > default`. `autoTriage` gates only the AUTO-DISPOSITION exception, not whether the triage rung runs, which is the naming trap this slice fixes. The 3-state makes the rung honestly off/ask/auto. The two question-surfacing gates are `observationTriage` (this) and `surfaceBlockers` (a sibling slice); they are orthogonal peers. `needs-attention` (a build hit a wall) is separate and ALWAYS on, do NOT touch it.
>
> NO ALIAS: this repo has no external users yet (decided 2026-06-12), so DELETE `autoTriage` outright and replace it with `observationTriage`. Do NOT add a `config-alias.ts` entry, do NOT build a boolean->enum value map, do NOT keep `AGENT_RUNNER_AUTO_TRIAGE`. (A value-migrating alias would also TRAP on the env path: the legacy-alias loop coerces the OLD var with the NEW key's coercion, so `AGENT_RUNNER_AUTO_TRIAGE=false` against an enum coercion throws. Sidestepped by not aliasing.) The separate `allowAgents` alias removal is a DIFFERENT slice; do not touch it here.
>
> BUILD: (1) the `Config` enum field + default `off` (remove `autoTriage`); (2) the full chain (REPO_ALLOWED_KEYS swap, an ENUM coercion in env-config like `integration`, a NEW `--observation-triage <off|ask|auto>` flag); (3) the read site at the triage rung honouring all three states, with `off` short-circuiting at the selection/eligibility layer so an `off` repo never classifies an observation as a candidate; UPDATE BOTH `cli.ts` threading sites; (4) keep explicit `advance obs:<slug>` bypassing the gate; (5) do NOT gate the `apply` rung, an answered sidecar still applies under `off` (the create-vs-consume invariant).
>
> TEST (TDD, vitest, house style): the three states end-to-end (`off` = observation untouched / no sidecar; `ask` = question surfaced; `auto` = duplicate/map auto-disposed + question for the rest); the explicit-bypass; apply-still-runs-under-off (a committed answer is honoured regardless of the gate); the enum-coercion loud-failure on a bad value. Isolate all shared/global locations to temp fixtures.
>
> "Done" = `observationTriage` resolves through the full chain, the triage rung honours off/ask/auto, `autoTriage` is fully removed (no alias, both cli.ts sites migrated), explicit `obs:` bypasses, apply still runs under `off`, and the gate is green.
