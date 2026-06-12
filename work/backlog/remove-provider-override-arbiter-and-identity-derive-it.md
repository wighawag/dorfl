---
title: remove-provider-override-arbiter-and-identity-derive-it — delete the `provider` config field AND the `--provider` flag entirely; the review-request provider is purely ARBITER-derived (GitHub URL ⇒ GitHubProvider, else NoneProvider), and the identity's `providers.github` auth is the "do we actually open PRs" signal (absent ⇒ `gh` degrades to manual-PR instructions); the old `provider: none` / `provider: github` overrides go away (suppress PRs via merge mode or by omitting the github identity object)
slug: remove-provider-override-arbiter-and-identity-derive-it
blockedBy: []
covers: []
---

> Self-contained SIMPLIFICATION slice — derives from NO PRD (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Source signal (discharged into this slice on authoring): `work/observations/provider-should-stay-arbiter-derived.md` (2026-06-06; maintainer: "the provider is dependent on the arbiter, so we should never have it as an independent choice").
>
> MAINTAINER DECISIONS (settled 2026-06-12 — implement, do not re-open):
> - Remove the `provider` axis ENTIRELY (both the config field and the `--provider` flag), not just the `github`-force value. With IDENTITY + ARBITER now first-class, the provider is fully determined: the ARBITER URL says WHICH provider (GitHub URL ⇒ GitHubProvider, else NoneProvider), and the identity's `providers.github` says whether `gh` is AUTHED to actually open PRs (absent ⇒ `gh` degrades). A separate `provider` config can only CONTRADICT those, so it goes.
> - The old `provider: none` ("GitHub arbiter but suppress the PR") affordance is DROPPED. Its uses are now expressed by: (i) `integration: merge` (push to main, no branch, no PR), or (ii) OMITTING the `providers.github` object from the identity (no `gh` auth ⇒ no PR opened, the provider degrades to manual-PR instructions), or (iii) a non-GitHub arbiter (NoneProvider auto-derived).
> - A dedicated `noPR` / push-the-branch-without-opening-a-PR mode is an EXPLICIT NON-GOAL of this slice (maintainer unsure it is useful). Do NOT build it; record it as an open question for later if the dropped propose+none affordance is missed.

## What exists today (verify against current code)

- `selectProvider` (`src/github.ts` ~L133-145) picks the provider: `override === 'none'` ⇒ NoneProvider, `override === 'github'` ⇒ GitHubProvider, else AUTO-DETECT from the arbiter URL (GitHub URL ⇒ GitHubProvider, else NoneProvider). The `override` is the `provider` config value.
- The `provider` config field is `ReviewProviderName = 'none' | 'github'` (`src/config.ts` ~L30/L138), validated in env (`src/env-config.ts` ~L77 `enum: ['none','github']`), and there is a `--provider <name>` flag on the **`run`** command (`src/cli.ts` ~L850; `runFlagOverrides` ~L408 maps it). `do`/`complete` have NO `--provider` flag (only read `config.provider`).
- IDENTITY already carries the GitHub provider auth: `Identity.providers.github?: GitHubProviderAuth` (`src/identity.ts` ~L70-72) — "WHO opens the PR / posts the comment, via `GH_TOKEN`; absent ⇒ `gh` degrades" (identity.ts doc ~L17-20). It supplies the TOKEN to whatever provider runs; it does NOT currently pick the provider (`selectProvider` does not consult identity — verified).
- NoneProvider.openRequest returns `{opened: false}` (`src/github.ts` ~L172-178); a GitHub provider with no/failed `gh` auth DEGRADES to manual-PR instructions (never hard-fails, ADR §6). So "no PR" is ALREADY a graceful built-in outcome, not an error.

So the `provider` override is the ONE axis that can disagree with the arbiter (`provider: github` on a non-GitHub arbiter can never do anything useful; `provider: none` on a GitHub arbiter is the narrow "suppress PR" the identity/merge-mode now cover).

## What to build

1. **Remove the `provider` config field AND the threaded override parameter (mind the two `provider`s).** CRITICAL DISTINCTION the builder must hold: there are TWO different `provider`s in the code:
   - **(A) the config OVERRIDE** — `config.provider: ReviewProviderName` (`'none'|'github'`), threaded as an `options.provider` / `input.provider` PARAMETER through the whole integration call chain. THIS is what gets removed.
   - **(B) the resolved provider INSTANCE** — the `ReviewProvider` object that `selectProvider(...)` RETURNS, threaded into the integrator (`src/integrator.ts` ~L290 `this.provider = options.provider ?? new NoneProvider()`, `run.ts` ~L733 `providerInstance`). THIS STAYS — it is how the arbiter-derived provider is injected; do NOT remove it.
   Remove (A) end-to-end: the config field (`src/config.ts` ~L138), the env schema (`src/env-config.ts` ~L77), `DEFAULT_CONFIG` if present, and the WHOLE threaded `provider?: ReviewProviderName` parameter on the options/input types that carry the OVERRIDE (`do.ts` ~L209/L359, `complete.ts` ~L208, `integration-core.ts` ~L182, `intake.ts` ~L245, `slicing.ts`, plus the ~7 `provider: config.provider` / `options.provider` pass-through sites in `cli.ts` ~L270/L1385/L1680/L1810/L1997/L2371 and `run.ts` ~L732/L1050) — grep `config.provider` / `provider?: ReviewProviderName` / `input.provider` and remove the override plumbing, leaving the resolved-INSTANCE plumbing (B) intact. Keep the `ReviewProviderName`/`ProviderName` TYPE (`'none' | 'github'`) — it still names which provider `selectProvider` RETURNS.

2. **Remove the `--provider` flag** from `run` (`src/cli.ts` ~L850) and its mapping in `runFlagOverrides` (~L408). No other command has it.

3. **Make `selectProvider` purely arbiter-derived.** Drop the `override` parameter and its two branches (`src/github.ts` ~L134-140); the function becomes "GitHub arbiter URL ⇒ GitHubProvider, else NoneProvider." At the single call site (`src/integration-core.ts` ~L701-708) the resolution is `const provider = input.providerInstance ?? (input.openPr ? bridgeProvider(input.openPr) : selectProvider({arbiterUrl, provider: input.provider}))` — KEEP the `providerInstance` and `bridgeProvider` arms (case B, the resolved instance); only DROP the `provider: input.provider` override arg so it becomes `selectProvider({arbiterUrl})`. The identity's `providers.github` continues to supply the `gh` token to the (now arbiter-derived) GitHubProvider exactly as today — so "GitHub arbiter + a github identity ⇒ real PRs"; "GitHub arbiter + NO github identity ⇒ `gh` degrades to manual-PR instructions"; "non-GitHub arbiter ⇒ NoneProvider".

4. **Migration: a stale `provider` in config/env must not break.** Decide + document in a `## Decisions` block: a leftover `provider:` key in an existing `.agent-runner.json` / `AGENT_RUNNER_PROVIDER` env should be IGNORED with a one-line deprecation WARNING (not a hard error), so an existing config keeps working. (Mirror how other removed/renamed keys are handled — e.g. the `allowAgents`→`autoBuild` alias precedent, but here it is removal-with-warning, not an alias.)

5. **Docs/skill sweep.** Update any doc/skill/ADR that documents `provider`/`--provider` as a knob (grep `docs/`, `skills/setup/`, ADRs, `CONTEXT.md`) to say the provider is arbiter-derived + identity-authed, and that "no PR" = merge mode / omit the github identity object / non-GitHub arbiter. Record the `noPR`-mode non-goal where appropriate.

## Scope

- IN: delete the `provider` config field + env schema entry + all `config.provider` reads; delete the `--provider` flag + its `runFlagOverrides` mapping; make `selectProvider` arbiter-only (drop the override param); a deprecation-warning (not error) for a stale `provider` key; the doc/skill/ADR sweep.
- OUT: a new `noPR` / propose-without-PR mode (EXPLICIT non-goal — record as an open question only); changing identity's `providers.github` shape or the `gh`-degrade behaviour; changing `integration` mode semantics; touching `selectProvider`'s RETURN type (`'none' | 'github'` stays — only the override input goes); the `run`-daemon's other flags.

## Acceptance criteria

- [ ] The `provider` config OVERRIDE is REMOVED end-to-end (config type, env schema, `DEFAULT_CONFIG`, the threaded `provider?: ReviewProviderName` parameter through cli/do/complete/run/intake/slicing/integration-core, every `config.provider`/`options.provider` override pass-through). The `--provider` flag is REMOVED from `run` (+ its `runFlagOverrides` mapping). Grep confirms no `provider` config/flag OVERRIDE axis remains. The RESOLVED provider INSTANCE threading (`integrator.ts` `options.provider` instance, `run.ts` `providerInstance`) is UNCHANGED, and the `ReviewProviderName` return type stays.
- [ ] `selectProvider` is purely arbiter-derived (no `override` param): GitHub arbiter URL ⇒ GitHubProvider, else NoneProvider. Tested: GitHub URL ⇒ github; `--bare`/non-GitHub ⇒ none; with NO `provider` input possible.
- [ ] "No PR on a GitHub arbiter" is still achievable WITHOUT the removed override: via `integration: merge` (no PR), OR by omitting `providers.github` from the identity (the GitHubProvider degrades to manual-PR instructions, `{opened:false}`-style, never hard-fails). A test covers "GitHub arbiter + no github identity ⇒ no PR opened, graceful degrade".
- [ ] A leftover `provider:` key in config / `AGENT_RUNNER_PROVIDER` env is IGNORED with a one-line deprecation WARNING (not a hard error) — an existing config keeps working. Tested.
- [ ] Docs/skills/ADRs/CONTEXT.md no longer document `provider`/`--provider` as a knob; they describe the arbiter-derived + identity-authed model and the merge-mode / omit-identity ways to suppress a PR. The `noPR`-mode non-goal is recorded.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. Small, mechanical removal across config/env/cli/github + a doc sweep; the identity provider-auth wiring it leans on already exists.

## Prompt

> Remove agent-runner's `provider` axis ENTIRELY — both the `provider` config field and the `--provider` flag. MAINTAINER DECISION: with IDENTITY + ARBITER first-class, the review-request provider is fully determined: the ARBITER URL says WHICH provider (GitHub URL ⇒ GitHubProvider, else NoneProvider), and the identity's `providers.github` auth says whether `gh` can actually open PRs (absent ⇒ `gh` degrades to manual-PR instructions — already graceful, ADR §6). A separate `provider` config can only CONTRADICT those (e.g. `provider: github` on a non-GitHub arbiter does nothing; `provider: none` on a GitHub arbiter is now covered by merge mode / omitting the github identity object), so it goes. A dedicated `noPR` / propose-without-PR mode is an EXPLICIT NON-GOAL (record as an open question, do NOT build).
>
> BUILD: (1) delete the `provider` config field (`src/config.ts` ~L138), the env schema entry (`src/env-config.ts` ~L77), `DEFAULT_CONFIG` if present, and every `config.provider` read (grep: `complete.ts` ~L102, `do.ts` ~L209/L359, `integration-core.ts` ~L182, `intake.ts`, `slicing.ts`) — keep the `ReviewProviderName` RETURN type. (2) delete the `--provider` flag on `run` (`src/cli.ts` ~L850) + its `runFlagOverrides` mapping (~L408). (3) make `selectProvider` (`src/github.ts` ~L133-145) arbiter-only (drop the `override` param + its `none`/`github` branches); update the call site (`src/integration-core.ts` ~L705). Identity's `providers.github` keeps supplying the `gh` token to the now-arbiter-derived GitHubProvider. (4) a STALE `provider:` config/env key is IGNORED with a one-line deprecation WARNING, not a hard error (existing configs keep working). (5) sweep docs/skills/ADRs/CONTEXT.md to describe the arbiter-derived + identity-authed model and the merge-mode / omit-identity / non-GitHub-arbiter ways to suppress a PR.
>
> READ FIRST: `src/github.ts` (`selectProvider` ~L133-145, `NoneProvider.openRequest` ~L172-178, the GitHub degrade behaviour); `src/config.ts` (`ReviewProviderName` ~L30, `provider` field ~L138); `src/env-config.ts` (~L77 enum); `src/cli.ts` (`--provider` on `run` ~L850, `runFlagOverrides` ~L408); `src/integration-core.ts` (`selectProvider` call ~L705); `src/identity.ts` (`Identity.providers.github` ~L70-72 + the doc ~L17-20 — the GitHub auth that is the real "open PRs?" signal); `complete.ts`/`do.ts`/`intake.ts`/`slicing.ts` (the `config.provider` reads to drop). Source signal: `work/observations/provider-should-stay-arbiter-derived.md`.
>
> SCOPE FENCE: do NOT build a `noPR` mode (non-goal, open question only); do NOT change identity's `providers.github` shape or the `gh`-degrade behaviour; do NOT change `integration` mode semantics; keep the `'none' | 'github'` RETURN type (only the config/flag OVERRIDE goes); a stale `provider` key warns, never errors. "Done" = no `provider` config field or `--provider` flag remains, `selectProvider` is purely arbiter-derived, no-PR is still achievable via merge mode / omitting the github identity, a stale `provider` key warns-and-is-ignored, the docs describe the new model, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

---

### Claiming this slice

```sh
agent-runner claim remove-provider-override-arbiter-and-identity-derive-it --arbiter origin
git fetch origin && git switch -c work/remove-provider-override-arbiter-and-identity-derive-it origin/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/remove-provider-override-arbiter-and-identity-derive-it.md work/done/remove-provider-override-arbiter-and-identity-derive-it.md
```
