---
title: 'Rename the SpecsLandIn value `pre-proposed → proposed` (hard cutover, no alias)'
slug: specs-land-in-proposed-rename
spec: intake-integration-knob-and-specs-land-in-proposed-rename
blockedBy: [intake-integration-knob]
covers: [7]
---

## What to build

Rename the `SpecsLandIn` config VALUE `'pre-proposed' → 'proposed'` everywhere, as a HARD cutover with no `pre-proposed` alias, so the spec-side placement value matches its on-disk folder `specs/proposed/` — exactly as the task side's `tasksLandIn: 'backlog'` matches `tasks/backlog/`. `pre-proposed` is a leftover of the earlier `pre-spec/` staging-folder prefix that survived the `folder-taxonomy-reorg-and-rename` rename.

Touch every occurrence: the `SpecsLandIn` type union, `DEFAULT_CONFIG` (`specsLandIn` + `untrustedSpecsLandIn`), the env-config enum(s) (`DORFL_SPECS_LAND_IN` / `DORFL_UNTRUSTED_SPECS_LAND_IN`), the repo-config passthrough, the CLI `--specs-land-in` validation + help text, `specLandingToSide` in `intake.ts` (the `landing === 'pre-proposed'` check), and the ~3 test refs. After the cutover, `pre-proposed` is an INVALID value that fails loudly through the existing enum validation (no silent back-compat read).

## Acceptance criteria

- [ ] `SpecsLandIn = 'proposed' | 'ready'`; no `pre-proposed` remains in src or tests (grep-clean).
- [ ] `DEFAULT_CONFIG.specsLandIn` and `.untrustedSpecsLandIn` are `'proposed'`.
- [ ] `DORFL_SPECS_LAND_IN=proposed` and `--specs-land-in proposed` are accepted; `pre-proposed` fails loudly (invalid enum value).
- [ ] Placement still lands intake specs in `work/specs/proposed/` (folder unchanged; only the VALUE spelling changed).
- [ ] Tests updated to the new value; the fail-loud-on-`pre-proposed` path covered.

## Blocked by

- Blocked by `intake-integration-knob` (both touch `config.ts` / `env-config.ts`; serialized to avoid a merge conflict — §3 file-orthogonality rule).

## Prompt

> Goal: fix a stale value-vs-folder drift — the `SpecsLandIn` config value is `pre-proposed` but its folder is `specs/proposed/`. Rename the VALUE to `proposed` (hard cutover, no alias) so it matches the folder, like `tasksLandIn: backlog` matches `tasks/backlog/`.
>
> Domain: `SpecsLandIn` is the spec-side placement value used by `specsLandIn` / `untrustedSpecsLandIn`, the env `DORFL_SPECS_LAND_IN` / `DORFL_UNTRUSTED_SPECS_LAND_IN`, and the CLI `--specs-land-in`. It is user-facing. The `pre-` prefix is a leftover of the old `pre-spec/` staging folder; the folder is now `proposed` (decided vocabulary, `folder-taxonomy-reorg-and-rename` US #7). This repo has no external users yet, so a HARD cutover with no alias is house style (mirrors the `autoTriage → observationTriage` clean cutover).
>
> Where to look: grep `pre-proposed` across `packages/dorfl/src` (~30 refs) and `packages/dorfl/test` (~3 refs). Key sites: the `SpecsLandIn` type + doc comments (`config.ts`), `DEFAULT_CONFIG`, the env-config enum table (`env-config.ts`), `repo-config.ts`, the CLI `--specs-land-in` parse/validate + help (`cli.ts`), and `specLandingToSide` (`intake.ts`, `landing === 'pre-proposed'`). Do NOT touch the on-disk folder `specs/proposed/` (already correct) — only the config VALUE spelling. Leave `tasksLandIn: 'backlog'` alone (already consistent).
>
> This is a wide mechanical rename but it stays green in ONE edit (change the type + every user together; a stale reference is a compile error), so it is a single vertical task, not expand/migrate/contract. Test that `proposed` is accepted end-to-end and `pre-proposed` now fails loudly. Governing spec: `intake-integration-knob-and-specs-land-in-proposed-rename`; finding: `work/notes/observations/specs-land-in-value-pre-proposed-should-be-proposed-2026-07-23.md`.
>
> Done: no `pre-proposed` remains, `proposed` works everywhere, placement folder unchanged, tests green, gate green.
