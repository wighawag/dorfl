---
title: 'erase artifact-word cutover — decisions recorded per the decision-bar rule (word-vs-identity boundary, alias preservation, historical-record normalization)'
date: 2026-07-10
---

Decisions taken while building `erase-prd-artifact-word-everywhere-spec-is-the-one-vocabulary` (spec `prd-to-spec-vocabulary-cutover-and-migration-command`). Recorded here (linked from the done record) because a reviewer / a later task / a user could be surprised these were decided here. (The retired token is written `` `prd` `` throughout \u2014 backticked \u2014 because this is meta-documentation of the cutover; the WORD scan exempts a backtick-wrapped token reference.)

## 1. `do prd:` / `advance prd:` / `prd:<slug>` verb-alias mentions in PROSE were PRESERVED (not flipped to `do spec:`)

The task's PRESERVE list keeps the live CODE aliases (`parseFrontmatter` `prd:` read, `do prd:` / `advance prd:` verb acceptance). I extended that preservation to the PROSE mentions of those alias forms across docs/skills/work, rather than teaching `do spec:` going forward. **Why:** the existing source-part leak scan (`prd-to-spec-leak-scan.test.ts`) already treats `prd:` (verb/field) and `prd:<slug>` / `work/prd-<slug>` as exempt DATA/namespace tokens; flipping the prose to `do spec:` would (a) diverge the two scans' allow-lists and (b) re-mean a still-published CLI surface without the code changing. The acceptance criterion targets the STANDALONE artifact WORD, and `prd:` is the alias token, not the bare word. **Touches:** the `do`/`advance` verb surface (unchanged), the two leak scans (kept aligned). **Alternative considered:** flip `do prd:` -> `do spec:` in prose to teach the canonical form \u2014 rejected as a verb-surface re-meaning that belongs with a deliberate CLI-alias-deprecation decision, not this WORD sweep.

## 2. The word-vs-identity BOUNDARY: the artifact word is swept as a whole word (hyphen/colon/slash-aware); camelCase + enumerated slugs + namespace forms are preserved

The sweep flips the artifact word only at word boundaries (boundary = not `[A-Za-z0-9_]`), so `prdBody`/`renderPrdBody`/`prd_flag` (camelCase/snake historical API + shell names) are untouched, while prose compounds like `prd-body` / `prd-level` DO flip (they are the word, not an identity). A concrete 44-token PRESERVE allow-list (the actual retired-token-containing basenames + frontmatter `slug:`/`spec:`/`blockedBy:`/`covers:`/`taskedAfter:` values present in the tree) protects slug identities where they appear literally. **Touches:** nothing outside this task; the same rule is encoded in the new `prd-word-cutover-leak-scan.test.ts` gate so it cannot re-drift.

## 3. `setup` migration-map + taxonomy-ADR legacy folder names (`work/prd/`, `work/pre-prd/`, `work/prd-tasked/`) were PRESERVED as rename SOURCES

`skills/setup/SKILL.md`'s legacy-flat -> umbrella `git mv` map has a LEFT column of OLD on-disk folder names a pre-umbrella repo LITERALLY has (`work/prd/` -> `work/specs/ready/`, `work/pre-prd/` -> `work/specs/proposed/`, `work/prd-tasked/` -> `work/specs/tasked/`). The blind sweep initially corrupted the LEFT column to `work/spec/`/`pre-spec/`; I RESTORED them \u2014 sweeping a rename SOURCE would point setup at a folder that does not exist in the repo being migrated. Same for the taxonomy ADR's named awkward-old candidate `prd-tasked`. These are the task's "code-fence path" preserve. **Touches:** `setup`'s migration correctness (a downstream user's `git mv`).

## 4. Historical folder-name-string LITERALS in `tasks/done/` records WERE swept (`pre-prd`/`prd`/`prd-sliced` folder keys -> `pre-spec`/`spec`/`spec-sliced`)

Unlike (3)'s migration-SOURCE names, the folder-key VALUE lists inside `tasks/done/` prose records (e.g. `work-layout-module-centralises-all-work-paths.md` listing the module's keys `pre-prd`, `prd`, `prd-sliced`) WERE flipped, because the acceptance criterion sweeps every standalone artifact word outside the enumerated PRESERVE set and the human goal is explicitly "read as if the retired word was ALWAYS `spec` \u2014 normalizing history is honest." These records now read in the `spec` vocabulary; a record's incidental claim "byte-identical to today" is now a projected-back normalization, not a literal point-in-time key snapshot. **Alternative considered:** preserve the folder-key literals as point-in-time record (like camelCase API names) \u2014 declined because they are lowercase folder-word literals the criterion targets, and the goal endorses historical normalization; camelCase symbol NAMES stay (they are proper-noun API identities the boundary rule already protects).

## Out-of-scope drift noticed (NOT fixed here)

`packages/dorfl/src/advance-lifecycle-template.ts` + `advance-ci-template.ts` + `tasking-lock.ts` still carry the artifact word in their JSDoc/comment prose. Only `tasking.ts` was this task's authorized code leak (the committed `docs/ci/advance-loop.yml.template` copy WAS swept). Those `packages/dorfl/src` prose occurrences are a separate code-vocabulary sweep. See `work/notes/observations/advance-lifecycle-template-src-prose-still-says-prd-2026-07-10.md`.
