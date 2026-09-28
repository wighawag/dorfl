---
title: 'install-ci drops auth-json mode (it cannot work without a write token in the agent job; use models-json with a proxy baseUrl)'
slug: install-ci-auth-json-mode-wires-its-secret
blockedBy: []
---

## What to build

Observation `install-ci-auth-json-never-wires-pi-auth-json`: in `auth-json` provider mode the generated `dorfl-setup` action reads `$PI_AUTH_JSON` (and its OAuth refresh script reads `$GH_PAT`), but no generated workflow ever sets either variable, so the mode has never worked for anyone.

**The human's decision (2026-09-28), which replaces this task's two open questions: remove `auth-json` mode entirely.** Reasons:

- auth-json carries pi's OAuth credentials, whose tokens expire within hours. The refresh step is the only thing that kept the stored secret valid, and it needs the write-capable `GH_PAT`, which ADR `ci-agent-job-holds-no-write-token` forbids in the agent job. Without the refresh the mode fails hours after setup; with it, it breaks the ADR.
- The supported alternative already works: `models-json` mode with a custom provider `baseUrl` pointing at a proxy that does the credential rotation outside GitHub (live since #429, e.g. intake on issue #426). Rotation is the proxy's job.
- Nobody depends on it (it never worked), so removal breaks no one.

Build:

- Remove the `auth-json` branch from `install-ci-core.ts`: the `AuthMode` value, the auth.json setup step, the OAuth refresh script and anything only it uses (`GH_PAT` for rotation; keep the unrelated `PR_IDENTITY` / other secrets untouched), and the related exports in `index.ts` if they become dead.
- Config: `"authMode": "auth-json"` in an install-ci config is rejected with a clear error that says the mode was removed and points at `models-json` with a provider `baseUrl` (a proxy) as the replacement. Decide whether `authMode` stays as a key that accepts only `"models-json"` (so existing configs still parse) or is dropped; prefer keeping existing `models-json` configs valid. Record the choice in Decisions.
- Update tests that exercised auth-json (drop or convert them) and the `install-ci` help/docs text that mentions it. Do not edit `work/specs/tasked/*` (historical).
- Mark observation `install-ci-auth-json-never-wires-pi-auth-json` resolved (note the removal).
- Add a changeset (the public config surface changes).

## Acceptance criteria

- [ ] No generated workflow or action references `PI_AUTH_JSON`, the auth.json setup step or the OAuth refresh script, and none carries a `GH_PAT` for rotation (template test).
- [ ] An install-ci config with `"authMode": "auth-json"` fails with an error naming the replacement (models-json + proxy `baseUrl`) (tested); existing `models-json` configs are unaffected.
- [ ] The workflow guard's agent-secret rule still accepts only provider credentials in the agent job.
- [ ] This repository's `.github/` is regenerated only if its output changes (it uses models-json, so it should not).
- [ ] The observation is marked resolved and a changeset is added.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: remove install-ci's `auth-json` provider mode (the human's decision in the task body), leaving `models-json` (with an optional proxy `baseUrl`) as the only mode, and make a leftover `auth-json` config fail with a pointer to the replacement. Read `packages/dorfl/src/install-ci-core.ts` (`AuthMode`, `generateSetupAction`, the refresh script, `providerSecretsWithBlock`), `install-ci.ts`, `index.ts`, the workflow guard (`test/helpers/workflow-guard.ts`) and the observation named in the task body. The task body lives in `work/tasks/backlog/` (a deliberate drive-from-staging build).

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **`authMode` stays as a config key that accepts only `"models-json"`.** Existing configs, and the `--export-config` output that always writes `"authMode": "models-json"`, keep parsing and exporting byte-identically, and a missing key still defaults to `models-json`. The alternative was dropping the key, but that would make every existing exported config carry an unknown key and change the export format. This touches `--config`, `--export-config` and the exported `AuthMode` type.
- **The refusal text is an exported constant, `AUTH_JSON_REMOVED_MESSAGE`,** so tests and other consumers can match it. Other unknown values keep a generic error (`must be "models-json"`). The alternative was one generic message for everything, but that would not point at the replacement, which the task requires.
- **The wizard's auth-mode question is removed rather than kept with one choice.** A one-option question adds nothing. This changes the order of the wizard's questions for anyone scripting it; the byte-identical wizard-vs-config test was updated to the new order.
- **`REFRESH_OAUTH_SCRIPT` is removed from the public exports and the changeset is `minor`.** Refusing a previously accepted config value and removing an export is a breaking change for a 0.x package. The alternative was `patch`, on the grounds that the mode never worked.
