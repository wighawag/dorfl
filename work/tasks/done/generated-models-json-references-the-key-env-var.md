---
title: 'The models.json that install-ci generates must reference the provider key as $ENV_VAR, which the pinned pi reads as an env var'
slug: generated-models-json-references-the-key-env-var
humanOnly: true
blockedBy: []
needsAnswers: false
---

## What to build

Every CI agent launch fails with `401 Unauthorized` even with a valid provider token (intake runs 36409392007 and 36412524418 on issue #426, after `pin-the-pi-harness-transitive-dependencies` fixed the harness install).

Cause, reproduced locally with the pinned harness (`@earendil-works/pi-coding-agent@0.80.6`): the generated `models.json` writes the provider key as `"apiKey": "ANTHROPIC_API_KEY"`, meaning the env-var NAME (`install-ci-core.ts`, the models-json entry built from `apiKeyEnvVar`, around the comment "`models.json`'s `apiKey` is the env-var NAME"). pi 0.80.6 resolves config values in `dist/core/resolve-config-value.js`: a value starting with `!` is a shell command, `$NAME` or `${NAME}` is an env-var reference, and ANYTHING ELSE IS A LITERAL. So pi sent the literal string `ANTHROPIC_API_KEY` as the token. With the same config locally, `pi --print` returns `401 Unauthorized`; the same token sent directly with `x-api-key` returns HTTP 200.

Emit env-var references in the form the pinned harness resolves (`"$ANTHROPIC_API_KEY"`, generally `"$" + apiKeyEnvVar`, or `${...}`), for every provider entry the generators write, and fix the explanatory comments. Check every other place dorfl writes a pi config value that is meant to be an env-var reference (headers, other providers, the auth-json path). Regenerate this repository's `.github/actions/dorfl-setup`. Consider a smoke check stronger than `pi --version` that proves the key resolves without spending a model call (for example asserting the rendered `models.json` value starts with `$` in a template test, since a live call needs the secret).

`humanOnly` because it edits `.github/` (CI refuses to land it). Build it locally.

## Acceptance criteria

- [ ] Every generated `models.json` provider entry references its key as `$<ENV_VAR>` (template test over registry and workspace mode and each provider shape).
- [ ] A test resolves the generated `models.json` the way pi 0.80.6 does (or pins the rule in a test with a comment citing `resolve-config-value.js`) and shows the env var's value is what would be sent, not the name.
- [ ] This repository's regenerated `.github/actions/dorfl-setup` carries the fix and passes the workflow guard and the existing workflow tests.
- [ ] A patch changeset explains the 401 and says to re-run `dorfl install-ci`.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: make the provider key in the `models.json` that `dorfl install-ci` generates resolve as an environment variable under the pinned pi harness. Read the models-json generation in `packages/dorfl/src/install-ci-core.ts` (`apiKeyEnvVar`, the provider entries, the "Export provider API key(s)" step), the regenerated `.github/actions/dorfl-setup/action.yml`, and pi's resolver in the installed harness (`npm view`/install `@earendil-works/pi-coding-agent@0.80.6` into a scratch dir and read `dist/core/resolve-config-value.js`, bounded). After this lands, a comment on issue #426 re-runs intake as the live check.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): if the generator already emits `$`-prefixed references, route the task to needs-attention with the discrepancy as the reason.
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **`$NAME` over `${NAME}`:** I emit `"$" + apiKeyEnvVar`, which is the form the task gave first. pi resolves both the same way for a plain env-var name. This affects only `buildModelsJson` and the file it generates. Existing `models.json` files on consumer repos stay broken until someone re-runs `install-ci`, as the changeset says.
- **New exported helper `modelsJsonEnvRef` in `install-ci-core.ts`:** I made it a named function so the resolver rule is documented in one place and tests can use it. I checked it against `CONTEXT.md`: it doesn't overlap any existing term. `ProviderEntry.apiKeyEnvVar` still means the bare name, because that is also the GitHub secret and action input name (`requiredSecretNames`, the export step). I considered storing `$NAME` in the config and rejected it, since that would break the secret names.
