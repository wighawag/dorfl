# intake-trigger-template.ts keeps `prd` in batch 3 (it is the `--merge-prd` CLI-flag surface)

2026-07-09, during task `rename-spec-config-and-intake` (prd→spec MIGRATE batch 3).

## Decision

`packages/dorfl/src/intake-trigger-template.ts` (and its test) were LEFT on the `prd` spelling in this batch, deliberately. The task listed it under "any `prd` in the emitted trigger surface", but on inspection every live `prd` in that module is the **`--merge-prd` / `--propose-prd` CLI-flag policy surface**: the module's own `IntakeIntegrationFlags.prd` field maps 1:1 onto those flags, `deriveIntakeFlags` returns `{prd, task, originTrust}`, and the emitted workflow YAML calls `dorfl intake --merge-prd`/`--propose-prd`. The test + validator assert those flag tokens literally.

Those CLI flags are defined in `cli.ts` (`--merge-prd`/`--propose-prd`, lines ~3678-3691) and have **no `spec` alias yet** (unlike `--specs-land-in`, which the expand task added beside `--prds-land-in`). Renaming the trigger-template field/flags to `spec` would emit a workflow that calls a flag `cli.ts` does not accept → broken. `cli.ts` flag definitions are explicitly **batch 4's** consumer scope (`rename-spec-remaining-src-modules` owns `cli.ts`).

Migrating ONLY the surrounding prose ("task/prd" → "task/spec") while the flag token stays `--merge-prd` would make the surface MORE incoherent (prose saying "spec" next to a `prd` flag), not less. So the coherent unit-of-change is: the `--merge-prd`/`--propose-prd` flag surface (field + flags + prose + trigger-template) migrates together WHEN the CLI flags rename — either in batch 4's `cli.ts` sweep or a dedicated cli-flag batch. This batch migrated the batch-3-owned surfaces (`repo-config.ts` `specsLandIn` canonical; `intake.ts` `IntakeArtifactType`/`IntakeIntegrationModes` key → `spec`, `spec-written` outcome, `dispatchSpec`, `Created spec` wording).

## What it touches

- `cli.ts` `--merge-prd`/`--propose-prd` flag definitions (batch 4).
- `intake.ts` `IntakeIntegrationFlags` (the CLI-flag input struct — `mergePrd`/`proposePrd` fields KEPT as `prd`; only the OUTPUT `IntakeIntegrationModes` key was migrated to `spec` because it is internal and cli.ts passes the object through opaquely).

## Alternative considered

Rename `--merge-prd` → `--merge-spec` here + add the `spec` flag alias to `cli.ts`. Rejected: that pulls `cli.ts` flag definitions into this batch (double-ownership with batch 4) and introduces a user-visible CLI-flag alias/default — a design change beyond this migrate batch's stated scope (config key + intake artifact-type + outcome wording).
