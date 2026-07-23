---
title: 'Vocabulary cutovers sweep the artifact WORD at word boundaries and preserve identities via an explicit allow-list'
status: accepted
created: 2026-07-12
---

# ADR: Vocabulary cutovers sweep the artifact WORD at word boundaries and preserve identities via an explicit allow-list

# Vocabulary cutovers sweep the artifact WORD at word boundaries and preserve identities via an explicit allow-list

**Context.** The `prd` → `spec` cutover (spec `prd-to-spec-vocabulary-cutover-and-migration-command`, task `erase-prd-artifact-word-everywhere-spec-is-the-one-vocabulary`) had to sweep a retired artifact WORD across docs / skills / work / code prose WITHOUT corrupting three classes of literals that look the same to a blind text substitution: (a) camelCase / snake_case / shell API identifiers whose NAME is a proper-noun identity (`renderPrdBody`, `prdBody`, `prd_flag`), (b) enumerated slug identities that literally embed the retired token (frontmatter `slug:` / `spec:` / `blockedBy:` / `covers:` / `taskedAfter:` values, and the on-disk basenames of the retired-token-containing files), and (c) rename-SOURCE folder names in `skills/setup/SKILL.md`'s legacy-flat → umbrella `git mv` migration map, whose LEFT column is the OLD folder a pre-umbrella target repo literally has on disk (`work/prd/`, `work/pre-prd/`, `work/prd-tasked/`) — sweeping those would point `setup` at a folder that does NOT exist in the repo being migrated. A blind sweep hit all three classes on the first pass. The decisions taken while landing that cutover are recorded in `work/notes/observations/erase-prd-word-cutover-decisions-2026-07-10.md`; the two load-bearing ones are promoted here because they are now enforced by a gate test (`packages/dorfl/test/prd-word-cutover-leak-scan.test.ts`) and are likely to govern FUTURE vocabulary cutovers (any similar retire-a-word-everywhere sweep).

**Decision.** Vocabulary cutovers in this repo follow a two-part discipline:

1. **Word-vs-identity boundary.** The retired artifact WORD is flipped ONLY at word boundaries, where a boundary is any character NOT in `[A-Za-z0-9_]`. Consequences:
   - camelCase / PascalCase / snake_case identifiers (`prdBody`, `renderPrdBody`, `prd_flag`) are UNTOUCHED — the retired token is glued to a letter or `_`, so it is not the whole word;
   - prose compounds with hyphen / colon / slash separators (`prd-body`, `prd-level`, `prd:<slug>` at a prose boundary) DO flip — the separator IS a word boundary, so the retired token stands alone as the WORD;
   - namespace / verb-alias forms that are legitimately still-live CLI surface (`do prd:`, `advance prd:`, `prd:<slug>`, `work/prd-<slug>`) are covered by the PRESERVE list below (see (2)), not by the boundary rule.

2. **PRESERVE-list discipline.** A concrete, enumerated allow-list of tokens / basenames / frontmatter-value strings that legitimately still contain the retired word is maintained ALONGSIDE the sweep and its gate test. The list is scoped to the actual literals present in the tree (for the `prd`→`spec` cutover: the 44 retired-token-containing basenames + the frontmatter `slug:` / `spec:` / `blockedBy:` / `covers:` / `taskedAfter:` VALUES that reference them + the `setup` migration-map LEFT-column folder names `work/prd/`, `work/pre-prd/`, `work/prd-tasked/` + the still-live verb-alias tokens `prd:` / `do prd:` / `advance prd:` / `prd:<slug>`). The SAME allow-list is shared between the existing source-part leak scan (`prd-to-spec-leak-scan.test.ts`) and the new whole-word leak scan (`prd-word-cutover-leak-scan.test.ts`) so the two gates cannot drift.

**Why.** The boundary rule captures the human intent of the cutover crisply — the target is the standalone artifact WORD, not any character sequence that spells it — and it is trivially machine-checkable (a single regex class). The PRESERVE-list carves out the residual identities the boundary rule cannot see: proper-noun API names that HAPPEN to compose to a word at a hyphen (`prd-body` in prose vs. `prdBody` in code), slug identities the corpus literally references, and the migration-SOURCE names whose correctness is defined by an OUT-OF-REPO reality (what a pre-umbrella target repo has on disk). Together they let the sweep be a one-command blind pass with a gate test that catches regressions, WITHOUT requiring the sweeper to hand-classify every hit.

**Blast radius / applies to.** Any future retire-a-word vocabulary cutover in this repo (e.g. renaming another artifact term). The recipe is:

- flip at `[^A-Za-z0-9_]` boundaries only;
- enumerate the PRESERVE list from the ACTUAL tree state (retired-token-containing basenames + frontmatter-value references to them + migration-map LEFT-column names + still-live CLI/alias tokens);
- land a whole-word leak-scan gate test that reads the SAME PRESERVE list as any pre-existing source-part scan.

Decisions from the same cutover that are NOT promoted here — verb-alias PROSE preservation (do not flip `do prd:` prose to `do spec:` while the CLI alias is still live) and `setup` migration-map SOURCE preservation — are captured in the landed cutover work and in the source observation; they are consequences of applying the PRESERVE-list discipline above to that specific cutover, not independent rules.

**Enforcement.** `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` encodes the boundary rule + PRESERVE list for the `prd`→`spec` cutover and fails on re-drift. Future cutovers SHOULD land an analogous gate; sharing the PRESERVE list with any pre-existing source-part scan is REQUIRED so the two gates cannot diverge.

**Pointers.**

- Source observation (decisions log for the `prd`→`spec` cutover): `work/notes/observations/erase-prd-word-cutover-decisions-2026-07-10.md`.
- Gate test: `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts`.
- Sibling source-part scan sharing the PRESERVE list: `packages/dorfl/test/prd-to-spec-leak-scan.test.ts`.
- Landing task: `erase-prd-artifact-word-everywhere-spec-is-the-one-vocabulary` under spec `prd-to-spec-vocabulary-cutover-and-migration-command`.
