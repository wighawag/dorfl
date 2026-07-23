---
title: 'HARD CUTOVER — remove the LAST prd back-compat (the parseFrontmatter prd: KEY read + the dead `do prd:`/`advance prd:` verb refs); no backward compatibility'
slug: hard-cutover-remove-last-prd-back-compat-key-and-dead-verb
spec: prd-to-spec-vocabulary-cutover-and-migration-command
covers: []
---

## What to build

Maintainer decision (2026-07-10): **dorfl wants NO backward compatibility for `prd`.** Two back-compat surfaces survived the earlier cutover as deliberate aliases; remove BOTH so `spec` is the only accepted form.

### A — remove the `parseFrontmatter` `prd:` KEY read (spec-only, hard cutover)

`frontmatter.ts` currently reads `key === 'spec' || key === 'prd'` into `fm.spec` (a read-only back-compat alias so un-migrated data still resolves). Remove it: read ONLY `key === 'spec'`. A repo migrates its data with `dorfl prd-to-spec` (a PURELY TEXTUAL `prd: → spec:` rewrite in `migrateItemContent` that does NOT go through `parseFrontmatter`), so removing the KEY read does NOT break the migration path — it just means an UN-migrated `prd:` field no longer silently resolves (correct for a hard cutover). Simplify the dual-populate block accordingly.

### B — flip the DEAD `do prd:`/`advance prd:` verb references → `do spec:`/`advance spec:`

The contract task already made `prd:` a DEAD namespace token (`parseSlugArg('prd:foo')` resolves as a BARE LITERAL slug, proven by the `slug-namespace.test.ts` HARD CUTOVER tests) — so `do prd:<slug>` no longer tasks a spec (it misroutes). ~59 stale `do prd:`/`advance prd:` references across ~15 src files (help text, prompts, comments) still show the dead form. Flip ALL to `do spec:`/`advance spec:`. Remove every now-FALSE "the legacy `prd:<slug>` is still accepted" / "still read" / "still accepted through the cutover" claim in `cli.ts` help + JSDoc (the promote verb help, the `do`/`advance` command descriptions + arg help, the `resolveTaskOnlySlug` JSDoc). This is a pure string/prose flip; `do prd:`/`advance prd:` never collide with the `prd:` FIELD key.

### C — correct the leak-scan allow-lists (stop exempting the dead aliases)

`prd-src-prose-leak-scan.test.ts` + `prd-word-cutover-leak-scan.test.ts` allow-list the `prd:` frontmatter-FIELD key + the `do prd:`/`advance prd:` VERB as "live CODE back-compat aliases." After A+B those are GONE. Correct the allow-list + its rationale: the ONLY legitimate `prd:`/`prd` survivors are now (1) the migration command `prd-to-spec.ts`'s OWN textual matcher (it matches `prd:` to REWRITE it — data territory, exempt WHOLE-FILE as it already is), (2) provenance slugs, (3) genuine English. There is no `prd:` field/verb back-compat to exempt. The scan should now FAIL on a stray `prd:` field-key or `do prd:` verb OUTSIDE the migration-command/provenance allow-list.

### D — flip the coupled test fixtures + assertions (the ripple)

Removing the `prd:` KEY read breaks ~14 tests whose FIXTURES build tasks with `prd:` frontmatter and expect linkage: `close-job.test.ts` (the `write(folder, file, {prd: …})` fixtures + the `write('prd', …)` FOLDER arg → the folder helper's `prd` case is also legacy), `prompt.test.ts` (`prd: ${prd}` fixture lines + `seedItem({prd: …})`), `spec-complete.test.ts` (`prd:<slug>` task fixtures). Flip every FIXTURE that writes `prd:` frontmatter → `spec:`, and any `write('prd', …)`/folder-arg `'prd'` → the `specs-*` folder. Flip the `parseFrontmatter` back-compat test (already done on main? verify) to assert the HARD CUTOVER (a `prd:` key is NOT read). Keep test DESCRIPTIONS coherent (a description saying "the prd case" may become "the spec case").

## PRESERVE (still — the genuinely-immutable set)
- `prd-to-spec.ts` (the migration command): its `prd:`/`prd`-matching regex + prose is DATA territory — exempt WHOLE-FILE (already is). It MUST keep matching `prd:` to convert it.
- Provenance slugs (`prd-to-spec-*`, `rename-spec-*`, filenames), camelCase historical API names in `tasks/done/`, English (`debrief`/`briefly`). NO file renames, NO slug-ref changes.

## Acceptance criteria
- [ ] `parseFrontmatter` reads ONLY `spec:` (no `prd:` KEY); a `prd:`-only frontmatter yields `fm.spec === undefined`; no `fm.prd` field. Proven by a HARD-CUTOVER test.
- [ ] No `do prd:`/`advance prd:` in `packages/dorfl/src` (all → `do spec:`/`advance spec:`); no "legacy prd:<slug> still accepted/read" claim remains.
- [ ] The two src/word leak scans no longer allow-list a `prd:` field/verb back-compat alias; they FAIL on a stray `prd:` field-key / `do prd:` verb outside the migration-command + provenance allow-list; the migration command stays exempt.
- [ ] All coupled fixtures/tests flipped (`close-job`/`prompt`/`spec-complete` + any other); `pnpm -r build && pnpm -r test && pnpm format:check` green.
- [ ] `dorfl prd-to-spec` STILL migrates a fixture repo's `prd:` data (textual) end-to-end (the command does not depend on the removed KEY read) — verify its fixture test still green.
- [ ] A `dorfl` changeset added (this is a behaviour/API change: `prd:` frontmatter no longer read).

## Prompt

> Goal (maintainer decision: NO backward compatibility for `prd`): remove the LAST two `prd` back-compat surfaces. (A) `frontmatter.ts`: read ONLY the `spec:` key, drop the `|| key === 'prd'` back-compat read (a repo migrates via `dorfl prd-to-spec`, a TEXTUAL rewrite that does not use this parser). (B) flip the ~59 DEAD `do prd:`/`advance prd:` refs across ~15 src files to `do spec:`/`advance spec:` and delete every now-false "legacy prd:<slug> is still accepted/read" claim (the contract task already made `prd:` a dead bare-literal token). (C) correct both leak-scan allow-lists to stop exempting the `prd:` field/verb as "live back-compat" — the only legit survivors are the migration command's own textual matcher (`prd-to-spec.ts`, exempt whole-file), provenance slugs, and English. (D) flip the ~14 coupled fixtures/tests (`close-job`/`prompt`/`spec-complete`: `prd:` fixture frontmatter + `write('prd',…)` folder args → `spec:`/`specs-*`).
>
> PRESERVE: `prd-to-spec.ts` (must keep matching `prd:` to convert it — data territory, whole-file exempt); provenance slugs / filenames / camelCase historical API names; English; NO file renames, NO slug-ref changes.
>
> Verify the migration command STILL works (its `migrateItemContent` is textual, not via `parseFrontmatter`) — its fixture test stays green. Done means: `spec:` is the ONLY read field, no dead `do prd:` refs, the scans gate the hard cutover, all fixtures flipped, full gate green, a changeset added. FIRST check drift: confirm the contract task's `prd:` dead-token cutover landed (`parseSlugArg('prd:foo')` → bare literal) so B is a doc/prose flip, not a code-behaviour change.
