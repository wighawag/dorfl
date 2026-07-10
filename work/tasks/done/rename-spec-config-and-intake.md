---
title: prd→spec batch 3 — config keys + intake artifact type
slug: rename-spec-config-and-intake
spec: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [rename-spec-frontmatter-field-and-slug-namespace]
covers: [1]
---

## What to build

MIGRATE the CONFIG + intake surface onto `spec` (the expand task already added `specsLandIn`/`'spec'` beside the `prd` forms, so this stays green). Make `spec` the canonical/primary spelling and migrate the call sites; KEEP the `prd` alias accepted (the contract task removes it). No hard rejection here.

- `repo-config.ts`: `prdsLandIn → specsLandIn` (key + its resolution/precedence + JSDoc); any `prdsFirst`-adjacent naming; the `taskingIntegration` values that name `prd` folders if any.
- `intake.ts`: `IntakeOutcome`/`IntakeArtifactType` `'prd' → 'spec'`; the intake per-emitted-type key `{task, prd} → {task, spec}`; the `'prd-written'`/`prded` outcome wording (mechanical `spec`-ing — pick the natural phrasing, e.g. `spec-written`); update `intake.test.ts` and any intake-trigger-template assertions in this task.
- `intake-trigger-template.ts`: any `prd` in the emitted trigger surface.

Config is a distinct file cluster from batch 2, so this is largely file-orthogonal; it blocks on batch 2 only because `intake` constructs artifacts whose frontmatter field is now `spec:`.

## Acceptance criteria

- [ ] `repo-config.ts` makes `specsLandIn` the canonical key (resolution + JSDoc); the `prdsLandIn` alias STILL resolves (expand added it; contract removes it); config-override tests updated in this task.
- [ ] `intake.ts` emits/uses the `'spec'` artifact type + `spec`-worded outcome as primary; the `'prd'` type still valid (alias); `intake.test.ts` + trigger-template tests updated in this task.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.
- [ ] NO hard rejection of `prdsLandIn`/`'prd'` here (contract task); `.dorfl.json` schema/example primary spelling is `specsLandIn` (the migration command rewrites a downstream repo's actual key — not this task).

## Blocked by

- rename-spec-frontmatter-field-and-slug-namespace (intake emits artifacts whose frontmatter field is now `spec:`).

## Prompt

> Goal: rename the config + intake surface from `prd` to `spec` — `repo-config.ts` (`prdsLandIn → specsLandIn`, resolution, JSDoc), `intake.ts` (`IntakeArtifactType`/`IntakeOutcome` `'prd' → 'spec'`, the `{task, prd} → {task, spec}` type key, the `prd-written` outcome wording), `intake-trigger-template.ts` — with coupled config-override / intake / trigger-template tests updated in the SAME task. Migrate-batch 3 of the parent spec `prd-to-spec-vocabulary-cutover-and-migration-command` (read it + `TASKING-PROTOCOL.md` §3a).
>
> Domain vocabulary: `prdsLandIn` is the per-repo placement default (staging vs pool) for tasked specs; `intake` turns an issue into a `task` or a `prd` artifact (or refuses); the outcome enum names those.
>
> Where to look: `repo-config.ts`, `intake.ts` + `intake.test.ts`, `intake-trigger-template.ts` + its test, `config-override.test.ts`. Update docs/fixtures that name `prdsLandIn`. Do NOT rewrite a real downstream `.dorfl.json` — the migration command does that; here you change the code + the schema/docs.
>
> Done means: config + intake speak `spec`, coupled tests updated, full gate green.
>
> FIRST check drift: confirm batch 2 landed and these surfaces still say `prd`.
