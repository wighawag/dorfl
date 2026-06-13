---
title: observationTriage - migrate the autoTriage BOOLEAN to a 3-state gate (off | ask | auto), adding the missing "off = skip observations entirely" state
slug: observation-triage-tri-state-gate
type: idea
status: incubating
---

# observationTriage: replace the `autoTriage` boolean with a 3-state gate

> Captured 2026-06-12 from the `runner-in-ci` design conversation (the `do`-vs-`advance` / CI-config grilling). Decision recorded in `docs/adr/ci-config-policy-and-gate-family.md`. NOT built; this is the engine change that ADR depends on. Sibling ideas: `surface-blockers-gate.md`, `run-uses-advance-tick.md`.

## The gap

`autoTriage` (boolean) gates only the AUTO-DISPOSITION exception of the observation-triage rung, NOT whether the rung runs. So:

- `autoTriage: false` (default) still RUNS triage and surfaces a promote/keep/delete question for EVERY untriaged observation.
- `autoTriage: true` auto-disposes the no-question cases (duplicate / unambiguous map) and surfaces a question for the rest.

The counterintuitive consequence: `false` produces MORE questions than `true` (it surfaces even the exact-duplicates `true` would silently clear). And there is NO way to express "leave my observations alone entirely" (the rung not running at all). The name `autoTriage` also reads like "is triage on?", a trap.

## The change

Replace the boolean with a 3-state enum gate **`observationTriage`**:

- **`off`**: the triage rung does NOT run; observations are left untouched (the NEW state the boolean could not express).
- **`ask`**: surface a promote/keep/delete question for every untriaged observation (== old `autoTriage: false`).
- **`auto`**: auto-dispose ONLY the no-question cases (duplicate ⇒ recommend delete; unambiguous map) and surface a question for judgement calls (== old `autoTriage: true`). Still never auto-deletes a non-duplicate or auto-promotes.

It is one of the two question-surfacing gates (the other is `surfaceBlockers`); they are orthogonal peers (see the ADR). Governs the observation INBOX (raw signal), distinct from declared-blocked work.

## Plumbing (the 5 gate-family points, mirror autoBuild/autoSlice/autoTriage)

1. `config.ts`: the field (enum), default `off`, merge handling.
2. `repo-config.ts` `REPO_ALLOWED_KEYS`: add `observationTriage` (per-repo `.agent-runner.json`).
3. `env-config.ts` `KEY_COERCIONS`: add an ENUM coercion (`{enum: ['off','ask','auto']}`, like `integration`), so `AGENT_RUNNER_OBSERVATION_TRIAGE` works (this is what gives CI/laptop env control).
4. CLI flags (`do-config.ts` + `cli.ts`) on `advance`/`run` for the full `flag > env > per-repo > global > default` chain.
5. Read site: the triage rung in `advance.ts` (and `run --advance` via `AdvanceContext`). The `off` state must make the classifier/selection NOT pick the observation (a no-op for that item), mirroring how `autoBuild: false` drops the build pool.

## Migration / deprecation

`autoTriage` keeps working as a DEPRECATED ALIAS for a window (`config-alias.ts`, like `allowAgents -> autoBuild`): `autoTriage: false -> observationTriage: ask`, `autoTriage: true -> observationTriage: auto`. The env var `AGENT_RUNNER_AUTO_TRIAGE` maps the same way. A deprecation warning on use.

## Scope notes

- Explicit `advance obs:<slug>` BYPASSES the gate (like `do <slug>` bypasses `autoBuild`); the gate binds only the auto-pick path.
- Plain `run`/`do` have no triage rung, so this gate is a no-op there (correct).
- Decide at PRD/slice time: does `off` skip the observation at the CLASSIFIER (return no-op) or at the SELECTION layer (never enter the pool)? The selection layer mirrors `autoBuild`/`autoSlice` and is likely cleaner.
