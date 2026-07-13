---
title: Wire the dorfl skills add command onto the install engine
slug: skills-add-cli-command
spec: skills-add-command
blockedBy: [skills-add-vendor-incur-agents-map]
covers: [1, 2, 4, 5]
---

## What to build

The CLI face of `dorfl skills add`: a `skills` command group with an `add` subcommand that installs the packaged dorfl skills into the operator's detected agent harness(es), built on the `installSkills` engine + resolver from `skills-add-vendor-incur-agents-map`. One vertical path: command registration → option parsing → call the engine against the resolved packaged skills → report what was installed and where.

- Register a `skills` command group and an `add` subcommand in the CLI, following the existing command-group registration pattern (the `remote` group with its subcommands, and `install-ci`, are the models — `new Command()`/`.command(...)` with a `HEADLINE_GROUP`/description, wired into the same `program`).
- `dorfl skills add` resolves the packaged skills source (via the resolver from the blocking task) and installs GLOBALLY by default; a `--local` (or equivalent) option installs project-locally into the current repo. Thread the option through to the engine.
- Report the outcome the way other dorfl commands do (human-readable lines to stdout via the shared output convention): the canonical install path(s) and, per non-universal harness, whether it was symlinked or copied. Make the effect visible and auditable.

## Acceptance criteria

- [ ] `dorfl skills add` exists as a subcommand under a `skills` group, registered in the same style as the `remote` / `install-ci` groups, and shows in `--help`.
- [ ] Running it installs the packaged skills into the canonical `~/.agents/skills/` and symlinks the detected non-universal harnesses, by delegating to the `installSkills` engine (no re-implementation of the harness map here).
- [ ] A `--local` (or equivalent) option installs project-locally instead of globally; global is the default.
- [ ] The command prints a clear report of installed canonical path(s) and per-harness symlink/copy results, using the repo's existing output/reporting convention.
- [ ] Tests cover the command wiring (mirror the repo's existing CLI test style): the command parses and calls the engine with the correct source dir and global/local option; the report reflects the engine's returned paths. Trust the engine's install behaviour (tested in the blocking task); assert the command's threading + reporting.
- [ ] **Shared-write isolation (WORK-CONTRACT.md):** any test that actually invokes the install path MUST override home/cwd to a temp/scratch dir and assert the real `~/.agents/skills/` and real harness dirs are UNTOUCHED. Prefer testing the command against the engine with a temp target; do not write to the real home.
- [ ] The acceptance gate stays green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- `skills-add-vendor-incur-agents-map` — provides the `installSkills` engine, the packaged-skills resolver, and the `dist/skills/` population this command depends on.

## Prompt

> Wire a `dorfl skills add` command onto the skill-install engine delivered by the blocking task `skills-add-vendor-incur-agents-map`. This task is ONLY the CLI face: command registration, option threading, and reporting. Do NOT re-implement the harness map or the install logic — call the `installSkills` engine.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): confirm the blocking task landed and the `installSkills` engine + packaged-skills resolver exist with the shape this task assumes (resolves the source dir, installs global/local, returns installed paths + per-harness results). If it landed differently, adapt to what actually exists or route to needs-attention rather than building on a stale premise (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> Domain: dorfl is a TS/Node pnpm monorepo (`type: module`, NodeNext, tsc, commander, vitest, prettier tabs+single-quotes). The command surface is defined in `docs/adr/command-surface-and-journeys.md`; the CLI is built with commander, and command GROUPS are registered by creating a sub-`Command` and hanging subcommands off it (the `remote` group and `install-ci` are the closest existing models). Output goes to stdout via the repo's shared output convention (see how other commands print reports + the `shouldUseColor`/output module).
>
> The dorfl skills being installed are the operator's toolbox (`from-idea`, `setup`, etc.); this installs them into the operator's OWN harness dirs, not into any target repo (consistent with ADR `methodology-and-skills` §6 — skills don't propagate into repos; only `work/protocol/` does). The ADR governing the mechanism is `docs/adr/skill-install-vendors-incur-agents-map.md`.
>
> Where to look (by concept): the `remote`/`install-ci` command-group registration in the CLI entry module for the group+subcommand pattern; the `installSkills` engine + resolver from the blocking task for what to call; the output module for how to print the install report.
>
> Seams to test at: the command wiring (does it call the engine with the right source + global/local option, and report its result?). Trust the engine's install behaviour. Done = `dorfl skills add` is registered, installs via the engine, reports clearly, is covered by isolated tests, and the gate is green.
>
> RECORD non-obvious in-scope decisions durably and linked from the done record (e.g. the exact `--local` flag name/spelling; whether `skills list`/`skills remove` are exposed now or deferred — the spec leaves this to the tasker/builder, so if you add them, say why; the report's exact format). ADR-worthy choices → `docs/adr/`; otherwise a JSDoc / `## Decisions` note. An un-recorded in-scope decision is a review finding.

---

### Claiming this task

```sh
dorfl claim skills-add-cli-command --arbiter <remote>
git fetch <remote> && git switch -c work/skills-add-cli-command <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/skills-add-cli-command.md work/tasks/done/skills-add-cli-command.md
```
