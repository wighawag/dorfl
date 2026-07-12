---
needsAnswers: true
---

# intake-trigger-template.ts keeps `spec` in batch 3 (it is the `--merge-spec` CLI-flag surface)

2026-07-09, during task `rename-spec-config-and-intake` (spec→spec MIGRATE batch 3).

## Decision

`packages/dorfl/src/intake-trigger-template.ts` (and its test) were LEFT on the `spec` spelling in this batch, deliberately. The task listed it under "any `spec` in the emitted trigger surface", but on inspection every live `spec` in that module is the **`--merge-spec` / `--propose-spec` CLI-flag policy surface**: the module's own `IntakeIntegrationFlags.spec` field maps 1:1 onto those flags, `deriveIntakeFlags` returns `{spec, task, originTrust}`, and the emitted workflow YAML calls `dorfl intake --merge-spec`/`--propose-spec`. The test + validator assert those flag tokens literally.

Those CLI flags are defined in `cli.ts` (`--merge-spec`/`--propose-spec`, lines ~3678-3691) and have **no `spec` alias yet** (unlike `--specs-land-in`, which the expand task added beside `--specs-land-in`). Renaming the trigger-template field/flags to `spec` would emit a workflow that calls a flag `cli.ts` does not accept → broken. `cli.ts` flag definitions are explicitly **batch 4's** consumer scope (`rename-spec-remaining-src-modules` owns `cli.ts`).

Migrating ONLY the surrounding prose ("task/spec" → "task/spec") while the flag token stays `--merge-spec` would make the surface MORE incoherent (prose saying "spec" next to a `spec` flag), not less. So the coherent unit-of-change is: the `--merge-spec`/`--propose-spec` flag surface (field + flags + prose + trigger-template) migrates together WHEN the CLI flags rename — either in batch 4's `cli.ts` sweep or a dedicated cli-flag batch. This batch migrated the batch-3-owned surfaces (`repo-config.ts` `specsLandIn` canonical; `intake.ts` `IntakeArtifactType`/`IntakeIntegrationModes` key → `spec`, `spec-written` outcome, `dispatchSpec`, `Created spec` wording).

## What it touches

- `cli.ts` `--merge-spec`/`--propose-spec` flag definitions (batch 4).
- `intake.ts` `IntakeIntegrationFlags` (the CLI-flag input struct — `mergePrd`/`proposePrd` fields KEPT as `spec`; only the OUTPUT `IntakeIntegrationModes` key was migrated to `spec` because it is internal and cli.ts passes the object through opaquely).

## Alternative considered

Rename `--merge-spec` → `--merge-spec` here + add the `spec` flag alias to `cli.ts`. Rejected: that pulls `cli.ts` flag definitions into this batch (double-ownership with batch 4) and introduces a user-visible CLI-flag alias/default — a design change beyond this migrate batch's stated scope (config key + intake artifact-type + outcome wording).
