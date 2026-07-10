---
title: Finish the spec cutover — protocol-doc work/specs→work/specs folder paths + the prd: frontmatter FIELD (docs + Frontmatter.spec→.spec code) + the resync VERSION-bump bug
slug: finish-spec-cutover-protocol-folder-paths-and-frontmatter-field
spec: prd-to-spec-vocabulary-cutover-and-migration-command
covers: []
---

## What to build

The source-part `spec → spec` cutover (option A) deliberately DEFERRED two doc/field surfaces, and nothing ever completed them. Now that the data-folder move + the migration command have shipped and been run (dorfl + downstream repos are on `work/specs/`), these deferrals are live DOC-vs-REALITY drifts surfaced by running `spec-to-spec` on a downstream repo (anonseed): the re-synced protocol contract still says `work/specs/` (folders that no longer exist) and teaches the `prd:` authoring field. Finish all three (A + B + the latent bug), then re-vendor/mirror/VERSION so `dorfl spec-to-spec` re-sync propagates the corrected contract downstream.

### A — protocol-doc `work/specs/ → work/specs/` folder paths (docs are stale; folders moved)

In `skills/setup/protocol/*` (`WORK-CONTRACT.md` ~27, `TASKING-PROTOCOL.md` ~9, `CLAIM-PROTOCOL.md` ~2, `task-template.md` ~1 — ~39 total), rewrite every `work/specs/...` / bare `specs/<lifecycle>` folder-path literal to `work/specs/...` / `specs/<lifecycle>` (keep-case; `specs/proposed|ready|tasked|dropped` → `specs/...`). The data folders are `work/specs/*` in every migrated repo now, so the contract must describe them. Also flip the `do prd:<slug>` / `advance prd:<slug>` VERB forms shown in the docs to the canonical `do spec:<slug>` / `advance spec:<slug>` (the dispatch accepts both; the docs should teach the canonical `spec:`).

### B — the `prd:` frontmatter FIELD → `spec:` (docs + code), keeping `prd:` KEY read as back-compat

The templates teach `prd: <source-slug>` but the migration writes `spec:` and migrated repos use `spec:`. Finish the field cutover:

- **Docs:** in `task-template.md` (`prd: <source-spec-slug>`), `WORK-CONTRACT.md` (`prd: historical-store` example + `### The spec link` + `Per-spec frontmatter` + every `prd:`-field mention), `TASKING-PROTOCOL.md` (the `- **`prd:`**` field row + `covers` "within `prd:`" + `issue:` mutual-exclusion mention), `CLAIM-PROTOCOL.md` (`the task's `prd:` field`) — teach the CANONICAL `spec:` field. Note back-compat: mention that the legacy `prd:` key is still READ (a repo mid-migration keeps working) but `spec:` is what to author.
- **Code (`frontmatter.ts`):** `Frontmatter.spec` already exists beside `Frontmatter.spec`. FLIP the ~8 `.spec` READERS onto `.spec` (`do.ts:1057/2248` `task.spec`, `prompt.ts:755` `task.spec`, `run.ts:811` `task.spec`, `resolveClosingIssue` reads `frontmatter.spec`, `close-job` linkage, any `fm.spec`), then DROP the `Frontmatter.spec` field + its `result.spec = value` populates. KEEP `parseFrontmatter` reading BOTH the `spec:` AND legacy `prd:` KEY, both populating `fm.spec` (back-compat for un-migrated downstream repos). So: the KEY read stays dual; the FIELD becomes `spec`-only.
- Update all coupled tests reading `fm.spec` / asserting the `.spec` field (the doc-consistency `tasking-protocol-doc.test.ts` canonical fixture + ~others).

### C — the latent `resyncProtocol` VERSION-bump-without-copy bug (`spec-to-spec.ts`)

`resyncProtocol` computes `unchanged = false` by DEFAULT and only sets it true when BOTH `existsSync(source)` and `existsSync(destAbs)`. So when a doc's SOURCE cannot be resolved (`existsSync(source) === false`), `unchanged` stays `false` → `anyDocChanged` is true → **VERSION is bumped even though NO doc was copied** (the copy is guarded by `existsSync(source)`). Fix: only count a doc as "changed" (VERSION-bump-worthy) when it was ACTUALLY copied (source existed AND content differed / dest absent) — track `copied`/`changed` from the real copy, not a default-false `unchanged`. A source that cannot resolve should be a LOUD warning (or a recorded skipped-doc), never a silent VERSION-only bump. Add a fixture test: a resync where a source doc is missing does NOT bump VERSION and surfaces the skip.

### Re-vendor + mirror + VERSION (so the fix propagates)

After A+B land in `skills/setup/protocol/*`: re-run the vendor step (`pnpm build` → `dist/protocol/*`) and mirror to `work/protocol/*` (this repo's own copy) so source == mirror == vendored byte-identical (the doc-consistency tests). Bump `work/protocol/VERSION`. A changeset for the dorfl package (patch/minor) so a release publishes the corrected contract; downstream repos then `dorfl spec-to-spec` (or a re-sync) to pick it up.

## Acceptance criteria

- [ ] A: no `work/specs/` or bare `specs/<lifecycle>` folder-path literal remains in `skills/setup/protocol/*` (all `work/specs/`); `do prd:`/`advance prd:` doc forms → `do spec:`/`advance spec:`.
- [ ] B-docs: the templates + contract teach `spec:` as the authoring field (legacy `prd:` key noted as still-read back-compat).
- [ ] B-code: the ~8 `.spec` readers flipped to `.spec`; `Frontmatter.spec` field + `result.spec` populates DROPPED; `parseFrontmatter` STILL reads both `spec:` and `prd:` KEYS into `fm.spec` (back-compat proven by test). No `.spec` field read remains.
- [ ] C: `resyncProtocol` only bumps VERSION for docs actually copied; a missing-source doc does NOT bump + is surfaced (tested).
- [ ] Source == `work/protocol/` mirror == `dist/protocol/` vendored byte-identical; VERSION bumped; a changeset added.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green; the doc-consistency + frontmatter + spec-to-spec tests updated + green.

## Open questions

1. Should `parseFrontmatter` EVER stop reading the legacy `prd:` key (a future hard cutover), or is the `prd:`-key read a permanent back-compat alias? (This task KEEPS it; a future task may retire it once all downstream repos are known-migrated.)

## Prompt

> Goal: finish the `spec → spec` cutover in the protocol CONTRACT + the frontmatter FIELD that option A deferred, surfaced live by running `dorfl spec-to-spec` on a downstream repo (its re-synced `work/protocol/*` still said `work/specs/` + taught `prd:`). THREE parts: (A) rewrite `work/specs/ → work/specs/` folder paths + `do/advance prd: → spec:` verb forms across `skills/setup/protocol/*`; (B) cut the `prd:` frontmatter FIELD over to `spec:` in the docs AND in code (flip the ~8 `.spec` readers to `.spec`, drop the `Frontmatter.spec` field + `result.spec` populate, but KEEP `parseFrontmatter` reading BOTH the `spec:` and legacy `prd:` KEYS into `fm.spec` — back-compat for un-migrated downstream repos); (C) fix the latent `resyncProtocol` bug where a non-resolvable source doc bumps VERSION without copying. Then re-vendor (`pnpm build`) + mirror `work/protocol/*` byte-identical + bump VERSION + add a changeset. Read the parent spec + `work/notes/observations/*` for the option-A rationale + `TASKING-PROTOCOL.md` §3a. AGENTS.md: edit the protocol SOURCE (`skills/setup/protocol/`), never `work/protocol/` directly (it is the propagated mirror); mirror them byte-identical.
>
> Scope boundary: the `prd:` KEY read in `parseFrontmatter` STAYS (dual `spec:`/`prd:` → `fm.spec`); only the internal `Frontmatter.spec` FIELD + its `.spec` readers go. Do NOT touch the migration command's DATA conversion or the leak scans beyond the resync bug. The `do prd:`/`advance prd:` VERB dispatch in CODE still accepts `prd:` (a CLI alias) — only the DOC examples flip to `spec:`.
>
> Done means: the contract describes `work/specs/` + teaches `spec:`, the code field is `spec`-only (with `prd:`-key back-compat), the resync bug is fixed + tested, source/mirror/vendored byte-identical, VERSION bumped, a changeset added, full gate green. Then a release publishes it and downstream repos re-sync the corrected contract.
>
> FIRST check drift: confirm the data-folder move + migration command already landed (dorfl is on `work/specs/`); confirm `Frontmatter.spec` exists beside `.spec` (it does) so B is a reader-flip + field-drop, not an add.
