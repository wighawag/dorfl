---
title: install-ci must NOT hardcode the AGENT_RUNNER_* gate policy into the emitted workflow env — it forces the env layer to win over the repo's own .agent-runner.json, defeating the flag > env > per-repo > global > default precedence; emit no gate env (let config decide) and let users add CI-only overrides themselves
slug: install-ci-emits-no-gate-env-let-config-decide
blockedBy: []
covers: []
---

## What to build

`install-ci` emits the advance workflow (`advance-lifecycle`) with a hardcoded `AGENT_RUNNER_*` gate env block — `AGENT_RUNNER_AUTO_BUILD`, `AGENT_RUNNER_AUTO_SLICE`, `AGENT_RUNNER_OBSERVATION_TRIAGE`, `AGENT_RUNNER_SURFACE_BLOCKERS` — baked in with the "calm" values (`true`/`true`/`off`/`false`). The source is `src/advance-lifecycle-template.ts` (~L211–214), and its structural validator (~L457–462) currently REQUIRES those env keys to be present.

This is wrong because of how the engine RESOLVES gate policy: `flag > env > per-repo .agent-runner.json > global > default`. By emitting the env block, install-ci FORCES the env layer to win over the repo's OWN `.agent-runner.json`. A user who sets e.g. `surfaceBlockers: true` (or `observationTriage: ask`) in their committed `.agent-runner.json` has it SILENTLY OVERRIDDEN by the workflow's `AGENT_RUNNER_SURFACE_BLOCKERS: false` — the env always wins. So per-repo config is dead-on-arrival for any gate the workflow hardcodes, which defeats the whole precedence design and is surprising (the user edits config and nothing changes).

THE PRINCIPLE (decided): the workflow env is the OPTIONAL CI-only OVERRIDE layer, not the carrier of defaults. The default source of truth is the repo's `.agent-runner.json` (then global, then the built-in calm defaults). So `install-ci` should emit the advance workflow WITHOUT the `AGENT_RUNNER_*` gate env block, letting the engine fall through to config/default. A user who genuinely wants a CI-SPECIFIC override (different in CI than locally) adds the env var themselves to their GitHub Actions env — that is the explicit, opt-in CI override the env layer is FOR.

Change:
- `src/advance-lifecycle-template.ts`: STOP emitting the `AGENT_RUNNER_AUTO_BUILD/AUTO_SLICE/OBSERVATION_TRIAGE/SURFACE_BLOCKERS` env lines. Replace with NOTHING (the engine resolves from config/default) — OR, if a discoverability hint is wanted, emit them COMMENTED-OUT as an opt-in example block (`# AGENT_RUNNER_SURFACE_BLOCKERS: 'true'  # uncomment to override your .agent-runner.json IN CI ONLY`). Decide which (Decisions): bare omission is cleanest (no dead config to drift); a commented example aids discoverability. Either way the ACTIVE workflow sets none of these.
- The template's structural VALIDATOR (~L457–462) must be updated: it currently REQUIRES the env keys; flip it to REQUIRE THEIR ABSENCE (or, for the commented-example variant, require they are commented, not active). Otherwise the validator rejects the corrected template.
- The calm defaults the env block used to assert (`AUTO_BUILD: true`, `AUTO_SLICE: true`, `OBSERVATION_TRIAGE: off`, `SURFACE_BLOCKERS: false`) must already be the engine's BUILT-IN defaults when nothing is set — VERIFY that resolving with no flag/env/per-repo/global yields exactly those, so removing the env block does NOT change behaviour for a config-less repo. If any default differs, that is a separate finding to surface, not silently paper over.

NOTE the relationship to the sibling slice `install-ci-emits-one-advance-workflow-not-redundant-build-slice-tick`: both edit `advance-lifecycle-template.ts` (and the build-slice-tick one DELETES `build-slice-tick-template.ts`). They are FILE-ADJACENT — serialise via `blockedBy` or coordinate so the rebase is trivial (see Blocked by). This slice changes the env block of the RETAINED advance workflow; that one removes the duplicate workflow.

## Acceptance criteria

- [ ] The emitted advance workflow contains NO ACTIVE `AGENT_RUNNER_AUTO_BUILD` / `AGENT_RUNNER_AUTO_SLICE` / `AGENT_RUNNER_OBSERVATION_TRIAGE` / `AGENT_RUNNER_SURFACE_BLOCKERS` env assignment (bare omission, or commented-out opt-in example per the recorded decision). A test asserts the emitted YAML sets none of these as active env.
- [ ] With NO gate env in the workflow, a repo's committed `.agent-runner.json` gate values (e.g. `surfaceBlockers: true`, `observationTriage: ask`) TAKE EFFECT in CI — i.e. the env no longer shadows per-repo config. A test asserts the resolution at the relevant seam picks up the per-repo value when the env is absent (mirror the existing `flag > env > per-repo > global > default` precedence tests, e.g. `remote-do-per-repo-config` / `*-config` tests).
- [ ] A config-less repo (no `.agent-runner.json`, no env) resolves to the SAME calm behaviour as today (`autoBuild`/`autoSlice` on, `observationTriage` off, `surfaceBlockers` false) via the engine's BUILT-IN defaults — removing the env block is behaviour-neutral for the default case. A test pins the built-in defaults match the old hardcoded values.
- [ ] The template's structural validator no longer REQUIRES the gate env keys (it required them before); it requires their ABSENCE-as-active (or commented form). A test pins the validator accepts the new no-gate-env template and rejects a re-introduced active gate env block.
- [ ] `intake` / `close-job` workflows and the non-gate env (auth, `GH_TOKEN`, `INTEGRATION_MODE`, etc.) are UNAFFECTED — only the four `AGENT_RUNNER_*` GATE keys are removed. (Note: `INTEGRATION_MODE` / the propose-vs-merge plumbing is NOT a gate-family key and stays.)
- [ ] The Decisions choice (bare omission vs commented example) is recorded (ADR if it meets the bar, else a `## Decisions` note in the done record/PR).
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- `install-ci-emits-one-advance-workflow-not-redundant-build-slice-tick` — NOT a logical dependency but a FILE-ORTHOGONALITY serialiser: both edit `src/advance-lifecycle-template.ts` (that slice keeps it as the sole advance workflow; this slice strips its gate env block). Build that one first so this rebases trivially. If at build time that slice has NOT landed, either build it first or coordinate the edits; do NOT both-touch the file in parallel.

## Prompt

> FIRST, drift-check: confirm `src/advance-lifecycle-template.ts` still emits the four `AGENT_RUNNER_*` GATE env keys (~L211–214) AND its structural validator still REQUIRES them (~L457–462), and confirm the engine's gate-resolution precedence is `flag > env > per-repo .agent-runner.json > global > default` (the `*-config` tests + `loadConfig`/the resolver). VERIFY the built-in defaults (no flag/env/per-repo/global) are exactly `autoBuild:true, autoSlice:true, observationTriage:off, surfaceBlockers:false` — if not, surface that as a finding. If a prior change already removed the gate env from the emitted workflow, route to needs-attention noting that.
>
> WHY: emitting the gate env FORCES the env layer to win over the repo's own `.agent-runner.json`, so per-repo gate config is silently ignored in CI — the env should be the OPTIONAL CI-only override, not the default carrier. The default source of truth is config (then global, then built-in calm defaults). The user observed this: they could not enable the question cycle (`surfaceBlockers`/`observationTriage`) via config because the hardcoded workflow env overrode it.
>
> GOAL: emit the advance workflow with NO active `AGENT_RUNNER_*` gate env (bare omission preferred; a commented-out opt-in example is acceptable if discoverability is wanted — record which), update the template's structural validator to match (it currently REQUIRES the keys — flip to require absence/commented), and VERIFY removing the env block is behaviour-neutral for a config-less repo (built-in defaults already equal the old hardcoded values). Touch ONLY the four gate keys; leave auth / `GH_TOKEN` / `INTEGRATION_MODE` / intake / close-job alone.
>
> SEAM TO TEST AT: the install-ci emitter output for the advance workflow (assert no active gate env) + its structural validator (accepts no-gate-env, rejects re-introduced active gate env) + the gate-resolution precedence (per-repo `.agent-runner.json` now takes effect when env is absent; config-less repo still resolves to the calm defaults). Mirror the existing `*-template.test.ts` / `install-ci.test.ts` / `*-config.test.ts`. No network.
>
> DONE: install-ci emits no active gate env in the workflow, per-repo config now governs the gates in CI, a config-less repo is behaviour-identical to today, the validator matches, the decision is recorded, and `pnpm -r build && pnpm -r test && pnpm format:check` passes. Do NOT perform git transitions (no stage/commit/push, no folder moves) — the runner/human owns those.
