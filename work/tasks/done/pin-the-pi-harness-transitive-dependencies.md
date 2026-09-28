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

## Decisions

- **Both modes now install the harness the same way: npm into a job-local folder with `overrides`.** I considered three alternatives:
  - Keeping `pnpm add -g` in workspace mode with the siblings listed next to the harness. I tested it: pnpm 11 puts each global package in its own folder, so the harness's own tree still pulled `pi-ai@0.80.10`.
  - `npm install -g` with the siblings listed. It has the same problem: each global package gets its own tree.
  - Keeping registry mode on `npm install -g` and relying on the shrinkwrap. That leaves the protection up to the package publisher.
  - This touches the `--install-source` modes: workspace mode no longer installs the harness through pnpm. The tests that asserted `pnpm add -g` now assert it is absent.
- **The harness bin folder is added to `PATH` through `$GITHUB_PATH`,** instead of relying on the npm/pnpm global bin already being on `PATH`. It works the same in both modes and consumers see no difference.
- **The check step is `pi --version`.** It loads the whole harness module graph, which I confirmed by reproducing the `getOAuthApiKey` crash with it. It needs no API key and makes no network call. The error text avoids backticks so the shell quoting stays simple.
- **I kept the harness at 0.80.6 rather than moving to 0.87.1.** The existing comment in the code says a harness upgrade should be a deliberate, tested bump. The code comment on `PI_HARNESS_PINNED_DEPENDENCIES` says to re-derive the list on any bump, because 0.87 adds `@earendil-works/chord`.
- **The npm install still runs install scripts, as the old global install did.** Adding `--ignore-scripts` would be a separate hardening change.
