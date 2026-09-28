---
title: 'Pin the CI agent harness together with its transitive pi packages, so a patch release cannot break every CI agent launch'
slug: pin-the-pi-harness-transitive-dependencies
humanOnly: true
blockedBy: []
---

## What to build

Every CI agent launch is broken today. `install-ci` pins the harness to `@earendil-works/pi-coding-agent@0.80.6` (`PI_HARNESS_VERSION` in `install-ci-core.ts`), but that package declares `@earendil-works/pi-ai: ^0.80.6` and `@earendil-works/pi-agent-core: ^0.80.6`, and on a `0.x` caret those float within `0.80.*`. `pi-ai@0.80.10` (published 2026-07-16) removed the `getOAuthApiKey` export that `pi-coding-agent@0.80.6` imports, so the harness dies on start:

```
SyntaxError: The requested module '@earendil-works/pi-ai/oauth' does not provide an export named 'getOAuthApiKey'
```

Measured on the first live run of the split intake workflow (issue #426, run 36405425615, agent job), and the last `advance-lifecycle` runs before it was disabled already logged `triage agent launch failed`. The split itself behaved correctly (the apply job removed the label and posted nothing); only the harness is broken.

Make the harness install reproducible: install the pi packages at versions that are known to work together (pin `pi-ai` and `pi-agent-core` explicitly in the same install command, or move to a current harness version and pin its whole pi family, or install from a lockfile), in both install modes (`npm install -g` and the workspace `pnpm add -g`). Add a cheap post-install smoke step in the generated agent setup action (for example `pi --version`, or whatever proves the module graph loads) so a broken install fails the setup step with a clear message instead of failing inside dorfl. Regenerate this repository's `.github/actions/dorfl-setup` with the new generator.

`humanOnly` for the same reason as `ci-split-generate-workflows`: it edits `.github/`, which CI refuses to land (decision 4 of ADR `ci-agent-job-holds-no-write-token`). Build it locally.

## Acceptance criteria

- [ ] The generated agent setup action installs the harness with every pi package it loads pinned to an exact version, in registry and workspace mode; a template test asserts the pins.
- [ ] The generated setup action fails early with a clear message when the installed harness cannot load (a template test asserts the smoke step exists).
- [ ] This repository's regenerated `.github/actions/dorfl-setup` carries the fix and passes the workflow guard and the existing workflow tests.
- [ ] A patch changeset explains the breakage and says to re-run `dorfl install-ci`.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: make dorfl's CI agent harness install immune to a transitive patch release. Read `PI_HARNESS_VERSION` and `harnessInstallStep` in `packages/dorfl/src/install-ci-core.ts`, the generated `.github/actions/dorfl-setup/action.yml`, and check the pi packages' published dependency ranges with `npm view` (bounded). Pick versions that load together, pin them all, add a smoke step, regenerate this repo's `.github/`. After it lands, a comment on issue #426 re-runs intake end to end, which is the live verification.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
