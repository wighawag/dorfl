---
title: install-ci must NOT hardcode the AGENT_RUNNER_* gate policy into the emitted workflow env — it forces the env layer to win over the repo's own .agent-runner.json, defeating the flag > env > per-repo > global > default precedence; stop shadowing per-repo config (let config decide) and let users add CI-only overrides themselves
slug: install-ci-emits-no-gate-env-let-config-decide
blockedBy: [install-ci-emits-one-advance-workflow-not-redundant-build-slice-tick]
covers: []
humanOnly: true
needsAnswers: true
---

## What to build

`install-ci` emits the advance workflow (`advance-lifecycle`) with a hardcoded `AGENT_RUNNER_*` gate env block — `AGENT_RUNNER_AUTO_BUILD`, `AGENT_RUNNER_AUTO_SLICE`, `AGENT_RUNNER_OBSERVATION_TRIAGE`, `AGENT_RUNNER_SURFACE_BLOCKERS` — baked in with the "calm" values (`true`/`true`/`off`/`false`). The source is `packages/agent-runner/src/advance-lifecycle-template.ts` (~L211–214), and its structural validator (~L457–472) currently REQUIRES those env keys to be present.

This is wrong because of how the engine RESOLVES gate policy: `flag > env > per-repo .agent-runner.json > global > default` (verified: `resolveRepoConfigFromLoaded` in `repo-config.ts` layers global → per-repo → env → flags). By emitting the env block, install-ci FORCES the env layer to win over the repo's OWN `.agent-runner.json`. A user who sets e.g. `surfaceBlockers: true` (or `observationTriage: ask`) in their committed `.agent-runner.json` has it SILENTLY OVERRIDDEN by the workflow's `AGENT_RUNNER_SURFACE_BLOCKERS: false` — the env always wins. So per-repo config is dead-on-arrival for any gate the workflow hardcodes, which defeats the whole precedence design and is surprising (the user edits config and nothing changes).

THE PRINCIPLE (decided): the workflow env is the OPTIONAL CI-only OVERRIDE layer, not the carrier of defaults. The default source of truth is the repo's `.agent-runner.json` (then global, then the built-in defaults). So `install-ci` should NOT emit gate env that shadows per-repo config; it should let the engine fall through to config/default. A user who genuinely wants a CI-SPECIFIC override (different in CI than locally) adds the env var themselves to their GitHub Actions env — that is the explicit, opt-in CI override the env layer is FOR.

> **CORRECTED PREMISE (drift, verified 2026-06-16) — this is the `needsAnswers` reason.** The original slice assumed bare removal of ALL FOUR keys is behaviour-neutral because the built-in defaults equal the hardcoded values. That is FALSE for two of them. `DEFAULT_CONFIG` (`packages/agent-runner/src/config.ts` ~L451–466) is `autoBuild: false`, `autoSlice: false`, `observationTriage: 'off'`, `surfaceBlockers: false`. So:
>
> - `OBSERVATION_TRIAGE` (`off`) and `SURFACE_BLOCKERS` (`false`) — built-in default MATCHES the hardcoded value. Removing these is behaviour-neutral for a config-less repo AND lets per-repo config govern. **Safe to drop.**
> - `AUTO_BUILD` (`true`) and `AUTO_SLICE` (`true`) — built-in default is the OPPOSITE (`false`). The env block is the ONLY thing turning CI autonomy ON. Bare removal would SILENTLY DISABLE auto-build and auto-slice in CI for any repo without an `.agent-runner.json` that sets them — NOT behaviour-neutral, and a regression.
>
> Keeping `AUTO_BUILD`/`AUTO_SLICE` as ACTIVE env, however, REINTRODUCES the exact shadowing this slice exists to kill (a repo that sets `autoBuild: false` in config to PAUSE CI autonomy would be overridden). So the two build/slice keys are a genuine DESIGN FORK, not a mechanical edit. **See `## Open questions` — a human must pick before this is built.**

Change (the UNCONTESTED part — the two LIFECYCLE keys):
- `packages/agent-runner/src/advance-lifecycle-template.ts`: STOP emitting the `AGENT_RUNNER_OBSERVATION_TRIAGE` / `AGENT_RUNNER_SURFACE_BLOCKERS` env lines (their built-in defaults already match, so dropping them is behaviour-neutral and lets per-repo config govern). Replace with NOTHING — OR, if a discoverability hint is wanted, emit them COMMENTED-OUT as an opt-in example block (`# AGENT_RUNNER_SURFACE_BLOCKERS: 'true'  # uncomment to override your .agent-runner.json IN CI ONLY`). Decide which (Decisions): bare omission is cleanest (no dead config to drift); a commented example aids discoverability.
- The build/slice keys (`AUTO_BUILD` / `AUTO_SLICE`) are handled per the resolved `## Open questions` answer (do NOT bare-drop them blind — that disables CI autonomy).
- The template's structural VALIDATOR (~L457–472) must be updated to match whatever active-env set survives: it currently REQUIRES all four; flip the dropped keys to REQUIRE THEIR ABSENCE-as-active (or commented form), and keep `require()` clauses only for any key the resolved decision KEEPS active. Otherwise the validator rejects the corrected template.

NOTE the relationship to the sibling slice `install-ci-emits-one-advance-workflow-not-redundant-build-slice-tick` (now in `work/in-progress/`): the overlap is SMALL, not the "both rewrite the same file" it first looked like. That sibling's own acceptance says advance-lifecycle's template is NOT modified — it only DELETES the `build-slice-tick` capability + template and removes a dangling HEADER-COMMENT reference to `build-slice-tick-template.ts` inside `advance-lifecycle-template.ts`. So the only shared file region is that one doc-comment, far from the env block this slice edits. The `blockedBy` is therefore a cheap ORDERING courtesy (land the deletion first so this slice rebases against a settled file + does not re-introduce a now-stale comment), NOT a genuine same-region conflict. If the sibling has already landed when this is built, the `blockedBy` is satisfied and there is nothing to coordinate.

## Open questions

Resolve these BEFORE building (this is why `needsAnswers: true`):

1. **What happens to `AUTO_BUILD` / `AUTO_SLICE` (built-in default `false`, env forces `true`)?** The slice's "let config decide" principle and "don't disable CI autonomy" pull in opposite directions for these two keys. Options:
   - **(a) Keep them active** in the workflow env (`AUTO_BUILD: 'true'`, `AUTO_SLICE: 'true'`) — preserves today's out-of-box CI autonomy, but a repo CANNOT pause CI autonomy via `.agent-runner.json` (the env still shadows it for these two). Accepts the shadowing for the two keys whose safe default is "on in CI".
   - **(b) Drop them too, but FLIP the built-in defaults** so `DEFAULT_CONFIG.autoBuild`/`autoSlice` become `true` — makes bare removal behaviour-neutral AND lets per-repo config govern. BUT this changes the engine's documented "strict, claim-nothing-by-default" stance for EVERY consumer (laptop `do`/`run`, not just CI), which `config.ts`'s comment calls deliberate. Likely too broad a blast radius for this slice.
   - **(c) Have install-ci WRITE the calm values into the repo's `.agent-runner.json`** (the per-repo layer, the actual default carrier) instead of env, so config — not env — turns CI autonomy on, and a user editing config genuinely governs it. Cleanest w.r.t. the principle; biggest scope (install-ci now seeds config keys).
   - **(d) Something else** (e.g. resolve a CI-only default at a different seam).
   Lean: (a) for THIS slice (smallest, preserves behaviour, kills the shadowing for the two keys where it actually bit the user — `surfaceBlockers`/`observationTriage`), and spin (b)/(c) into a follow-up if pausing CI autonomy via config is wanted. Maintainer decides.
2. **Bare omission vs commented-out example** for the dropped key(s) (discoverability vs no-dead-config). Lean: bare omission.

## Acceptance criteria

> These assume `## Open questions` Q1 is RESOLVED first. They are written for the leaning answer (a): drop the two LIFECYCLE keys, keep `AUTO_BUILD`/`AUTO_SLICE` active. ADJUST if the maintainer picks (b)/(c).

- [ ] The emitted advance workflow contains NO ACTIVE `AGENT_RUNNER_OBSERVATION_TRIAGE` / `AGENT_RUNNER_SURFACE_BLOCKERS` env assignment (bare omission, or commented-out opt-in example per the recorded decision). A test asserts the emitted YAML sets neither as active env.
- [ ] With those two keys absent from the workflow, a repo's committed `.agent-runner.json` values (`surfaceBlockers: true`, `observationTriage: ask`) TAKE EFFECT in CI — the env no longer shadows per-repo config for them. A test asserts the resolution at the relevant seam picks up the per-repo value when the env is absent (mirror the existing `flag > env > per-repo > global > default` precedence tests, e.g. `remote-do-per-repo-config` / `*-config` tests).
- [ ] BEHAVIOUR-NEUTRALITY is preserved for a config-less repo: `observationTriage` still resolves to `off` and `surfaceBlockers` to `false` via the BUILT-IN defaults (which MATCH the dropped hardcoded values — verified, `config.ts` `DEFAULT_CONFIG`), AND `autoBuild`/`autoSlice` are STILL ON in CI (because per Q1(a) their env stays active — they must NOT be bare-dropped, since the built-in default is `false`). A test pins both: the two dropped keys' built-in defaults equal their old hardcoded values, AND CI autonomy (`autoBuild`/`autoSlice`) is unchanged.
- [ ] The template's structural validator no longer REQUIRES the two dropped keys (it required all four before); it requires their ABSENCE-as-active (or commented form), and retains the `require()` clauses for any key Q1 keeps active (`AUTO_BUILD`/`AUTO_SLICE` under (a)). A test pins the validator accepts the corrected template and rejects a re-introduced active form of a dropped key.
- [ ] `intake` / `close-job` workflows and the non-gate env (auth, `GH_TOKEN`, `INTEGRATION_MODE`, etc.) are UNAFFECTED. (Note: `INTEGRATION_MODE` / the propose-vs-merge plumbing is NOT a gate-family key and stays.)
- [ ] The Decisions record captures BOTH the Q1 resolution (what happened to `AUTO_BUILD`/`AUTO_SLICE`) and the bare-omission-vs-commented choice (ADR if it meets the bar, else a `## Decisions` note in the done record/PR).
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- `install-ci-emits-one-advance-workflow-not-redundant-build-slice-tick` (in `work/in-progress/`) — a light ORDERING dependency, not a same-region conflict. CORRECTED (verified 2026-06-16): that sibling does NOT rewrite `advance-lifecycle-template.ts` (its acceptance explicitly states the advance-lifecycle template is NOT modified); it deletes the `build-slice-tick` capability/template and removes a dangling header-COMMENT reference inside `advance-lifecycle-template.ts`. The only shared file region is that doc-comment, not the env block this slice edits. Reason for the `blockedBy`: land the deletion first so this slice edits a settled file and does not re-touch a comment the sibling is removing. It is a courtesy to keep the rebase trivial, NOT a parallel double-edit of the env block.

## Prompt

> STOP — this slice is `needsAnswers: true`. Do NOT build until `## Open questions` Q1 is answered by the maintainer (what happens to `AUTO_BUILD`/`AUTO_SLICE`). Building blind risks DISABLING CI autonomy (their built-in default is `false`, not `true`). Once answered, follow this prompt with Q1's resolution substituted.
>
> FIRST, drift-check: confirm `packages/agent-runner/src/advance-lifecycle-template.ts` still emits the four `AGENT_RUNNER_*` GATE env keys (~L211–214) AND its structural validator still REQUIRES them (~L457–472), and confirm the engine's gate-resolution precedence is `flag > env > per-repo .agent-runner.json > global > default` (`resolveRepoConfigFromLoaded` in `repo-config.ts`; the `*-config` tests). RE-VERIFY the built-in defaults in `config.ts` `DEFAULT_CONFIG`: they are `autoBuild:false, autoSlice:false, observationTriage:'off', surfaceBlockers:false` — i.e. ONLY the two lifecycle keys match the hardcoded env; the two build/slice keys do NOT (this is the corrected premise). If the defaults have since changed, re-open Q1. If a prior change already removed the gate env, route to needs-attention noting that.
>
> WHY: emitting the gate env FORCES the env layer to win over the repo's own `.agent-runner.json`, so per-repo gate config is silently ignored in CI — the env should be the OPTIONAL CI-only override, not the default carrier. The user observed this: they could not enable the question cycle (`surfaceBlockers`/`observationTriage`) via config because the hardcoded workflow env overrode it.
>
> GOAL (leaning answer (a)): drop the two LIFECYCLE env keys (`OBSERVATION_TRIAGE`, `SURFACE_BLOCKERS`) so per-repo config governs them (their built-in defaults already match — behaviour-neutral); KEEP `AUTO_BUILD`/`AUTO_SLICE` active so CI autonomy is not silently disabled. Update the validator to require the dropped keys' ABSENCE-as-active (or commented) while keeping the `require()` for the kept keys. Touch ONLY the gate keys; leave auth / `GH_TOKEN` / `INTEGRATION_MODE` / intake / close-job alone. (If the maintainer picks (b) flip-defaults or (c) write-config-keys instead, follow that instead — the scope is larger.)
>
> SEAM TO TEST AT: the install-ci emitter output for the advance workflow (assert the dropped keys are absent-as-active, the kept keys present) + its structural validator (accepts the corrected template, rejects a re-introduced active form of a dropped key) + the gate-resolution precedence (per-repo `.agent-runner.json` now takes effect for the dropped keys when env is absent; config-less repo still resolves `observationTriage:off`/`surfaceBlockers:false` AND keeps `autoBuild`/`autoSlice` ON). Mirror the existing `*-template.test.ts` / `install-ci.test.ts` / `*-config.test.ts`. No network.
>
> DONE: the two lifecycle keys no longer shadow per-repo config in CI, CI autonomy (`autoBuild`/`autoSlice`) is behaviour-identical to today, a config-less repo is behaviour-identical to today, the validator matches, the Q1 + omission decisions are recorded, and `pnpm -r build && pnpm -r test && pnpm format:check` passes. Do NOT perform git transitions (no stage/commit/push, no folder moves) — the runner/human owns those.
