---
title: prd→spec EXPAND — add spec beside prd across the non-indirected identity surface (frontmatter, namespace, config, intake) so migrate batches stay green
slug: expand-spec-frontmatter-and-namespace-aliases
prd: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [rename-spec-work-layout-and-folders]
covers: [1, 3]
---

## What to build

The EXPAND step of the identity-layer wide refactor (`TASKING-PROTOCOL.md` §3a), inserted per review because the non-indirected `Frontmatter.prd` field and the `SlugNamespace 'prd'` literal are read directly at ~28 downstream call sites (owned by batches 3/4), so a hard swap cannot land green in isolation. This task ADDS the new `spec` form BESIDE the old `prd` form so every existing caller keeps compiling, enabling the migrate batches to move call sites onto `spec` one batch at a time while the gate stays green.

This single expand task adds the `spec` form beside `prd` for the WHOLE non-indirected identity surface the migrate batches (2, 3, 4) touch — frontmatter field, slug-namespace, config key, intake artifact type — so each of those batches can migrate its own call sites onto `spec` while the gate stays green (the `prd` form still resolves). The contract task removes every `prd` alias at the end.

Add, do NOT remove:

- **`frontmatter.ts` (`Frontmatter` + `parseFrontmatter`):** introduce `spec` alongside `prd`. `parseFrontmatter` reads EITHER the `spec:` key OR the `prd:` key from a file's frontmatter and populates BOTH `fm.spec` and `fm.prd` with the same value (so a caller reading either sees the parent-spec slug). The `via`/closure helper (`{via:'brief', prd}` etc. — note the `brief` remnant is batch 4's) keeps working. Keep `prd` present and populated; this is additive.
- **`slug-namespace.ts` (`SlugNamespace`, `PRD_PREFIX`, `workBranchRef`/parse):** widen `SlugNamespace` to include `'spec'` alongside `'prd'`; add a `spec:` prefix alongside `prd:`; the CLI arg resolver ACCEPTS both `spec:<slug>` and `prd:<slug>` (both resolve to the spec namespace); `workBranchRef`/parse handle both `work/spec-<slug>` and `work/prd-<slug>`. Nothing that emits `'prd'` today breaks.
- **`repo-config.ts` config key:** add `specsLandIn` as the canonical key alongside `prdsLandIn`; the resolver reads EITHER (`specsLandIn` wins if both present), and the `--specs-land-in` flag is added beside `--prds-land-in`. `PrdsLandIn` type gains a `SpecsLandIn` alias. Nothing that reads `prdsLandIn` (cli, config, env-config, placement, work-layout, intake) breaks.
- **`intake.ts` artifact type:** widen `IntakeArtifactType`/`IntakeOutcome` to include `'spec'` alongside `'prd'` (both valid), so `decision-engine.ts`/`index.ts` consumers keep compiling; the intake emit path can produce either until batch 3 migrates it.
- **Tests:** add tests asserting BOTH forms are accepted (a `spec:`-key file and a `prd:`-key file both parse; `spec:<slug>` and `prd:<slug>` both resolve; both config keys read; both artifact types valid). Do NOT reject the old form here — rejection is the CONTRACT task's job.

This is purely additive: after this task, `fm.prd` and `namespace === 'prd'` STILL compile and work, AND `fm.spec` / `spec:` also work. The migrate batches then move call sites onto the `spec` form; the contract task finally removes `prd` and adds the hard-cutover rejection.

## Acceptance criteria

- [ ] `parseFrontmatter` populates BOTH `fm.spec` and `fm.prd` from EITHER key; `Frontmatter` type carries both.
- [ ] `SlugNamespace` includes `'spec'`; `spec:<slug>` AND `prd:<slug>` both resolve; `work/spec-<slug>` AND `work/prd-<slug>` branch refs both parse.
- [ ] `repo-config.ts`: `specsLandIn` added beside `prdsLandIn` (resolver reads either); `--specs-land-in` flag added beside `--prds-land-in`.
- [ ] `intake.ts`: `IntakeArtifactType`/`IntakeOutcome` include `'spec'` beside `'prd'`; consumers (`decision-engine.ts`, `index.ts`) compile.
- [ ] Tests assert every added form is accepted (frontmatter key, namespace prefix, config key, artifact type) with no rejection of `prd` yet.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green — nothing that reads `fm.prd` or emits `'prd'` breaks (that is the whole point of expand).
- [ ] NO call site migrated onto `spec` here (that is the migrate batches) and NO `prd` form removed (that is the contract task). This task ONLY adds the new form beside the old.

## Blocked by

- rename-spec-work-layout-and-folders (folder identity is already `spec`; this adds the field/namespace `spec` form on top).

## Prompt

> Goal: the EXPAND step of an expand→migrate→contract wide refactor (read `work/protocol/TASKING-PROTOCOL.md` §3a and the parent spec `work/specs/tasked/prd-to-spec-vocabulary-cutover-and-migration-command.md`). Add the new `spec` form BESIDE the old `prd` form in `frontmatter.ts` (`parseFrontmatter` reads either `spec:` or `prd:` and populates BOTH `fm.spec` and `fm.prd`) and `slug-namespace.ts` (`SlugNamespace` gains `'spec'`; a `spec:` prefix is added; both `spec:<slug>` and `prd:<slug>` resolve; both `work/spec-<slug>` and `work/prd-<slug>` parse). Do NOT remove or migrate anything — every existing `fm.prd` read and `'prd'` emission MUST keep compiling and working. That is what makes the following migrate batches able to move call sites onto `spec` one at a time while staying green.
>
> Why this task exists: the review of the original batch split found that `Frontmatter.prd` + `SlugNamespace 'prd'` are non-indirected identifiers read at ~28 downstream sites, so a hard in-place swap cannot land green in isolation — §3a requires expand-first. This is that expand task.
>
> Domain vocabulary: the artifact is being renamed `prd → spec`; a task's frontmatter `prd:`/`spec:` points at its parent spec; `SlugNamespace` is the `task`/`prd`(→`spec`)/`observation` namespace the `do`/lock/branch identity uses. `via:'brief'` in close-job/frontmatter is a SEPARATE doubly-retired remnant owned by batch 4 — leave it.
>
> Where to look: `frontmatter.ts` (`Frontmatter`, `parseFrontmatter`), `slug-namespace.ts` (`SlugNamespace`, `PRD_PREFIX`, `workBranchRef` + its parse). Add tests that both forms are accepted.
>
> Done means: both `spec` and `prd` forms work side by side, the full gate is green, nothing removed or migrated. FIRST check drift: confirm `rename-spec-work-layout-and-folders` landed (folders are `work/specs/*`) and that the field/namespace still use `prd` (this task adds `spec` beside it).
