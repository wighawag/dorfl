---
promotedFrom: observation:prd-to-spec-4d-migrate-emit-sites-inserted-contract-sidecar-filepath-carveout-2026-07-10
consolidates:
  - observation:prd-to-spec-4e-residual-exported-symbols-inserted-2026-07-10
  - observation:prd-to-spec-value-aliases-are-not-symbol-aliases-exported-Prd-symbols-need-atomic-rename
  - observation:spec-migrate-4c-scope-decisions
---

## What to build

Create ONE new file `work/notes/findings/rename-cutover-lessons.md` that folds together the durable lessons from FOUR sibling observations of the prd→spec cutover into a single reusable rule about namespace / enum-value rename cutovers. This is a documentation-only task: no code, no ADR. The human ratified (2026-07-10) that this material belongs in `work/notes/findings/`, NOT `docs/adr/`.

> NOTE (consolidation): this task was merged from what the apply rung minted as four separate tasks (4d, 4e, value-aliases, and the un-minted 4c point), because all four resolved to "fold into the SAME shared note." Writing them as one task avoids two divergently-named files, duplicated content, and dangling provenance links. The `consolidates:` frontmatter lists the extra source observations this task also discharges.

The finding must cover, in the finding's own voice (not just quoted blocks), these points:

1. **Producer/consumer cutover coupling (from the 4d observation).** For a namespace/enum-value cutover, "migrate the consumers" is TWO jobs: widen CONSUMER `=== 'old'` checks (green on the alias), AND flip PRODUCER emit-site values + local union DEFINITIONS. The alias makes the consumer-widen green in isolation, which HIDES un-flipped producers, so an audit that only asks "does it stay green?" misses them. The producer flip is only forced at the CONTRACT step (alias removal) or by an identifier leak scan. Enumerate PRODUCERS and CONSUMERS separately.

2. **TYPE identity vs on-disk FILE identity (from the 4d observation).** When a value also keys an on-disk FILE (sidecar/lock), the producer flip is DATA-coupled: flipping the emitted value changes which file is read, so the file-path alias must OUTLIVE the type-value cutover and belongs to the data-migration command. The TYPE-member `'old'` is SOURCE (removed by the contract task); the on-disk FILENAME `old-<slug>.md` is DATA (converted + fallback removed by the migration command). Separate these two identities in the plan.

3. **The C-audit's single-lens blind spot — THREE enumerations, not one (from the 4e observation, twice-confirmed).** A coverage audit that maps a rename by ONE lens (e.g. `namespace === 'old'` consumer sites) is blind to at least two other surfaces. A rename cutover coverage audit needs THREE separate enumerations:
   1. **VALUE consumers** — `=== 'old'` sites; alias-covered; migrate incrementally.
   2. **VALUE producers** — emit-sites + local union type definitions; must be flipped or the alias silently hides them (the 4d gap).
   3. **Exported SYMBOLS / types / fields** — no alias possible; atomic rename; enumerate by `grep -rn "export.*Old"`, NOT a hand-curated list. The hand-curated list is exactly what dropped `renderPrd`, `buildIntakeDecisionPrd`, `findPrdPath`, `promoteFromPrePrd` (+ `PromoteFromPrePrdOptions` / `PromoteFromPrePrdResult`), and the `PrdsLandIn` plumbing (`config.prdsLandIn`, `prdLandingToSide`, `explicitPrdsLandIn`, `PerformIntakeOptions.prdsLandIn`, env-config schema) in the prd→spec cutover (the 4e gap).
   The contract-phase drift-check / leak scan is the honest backstop that caught both blind spots, precisely because it forces a real grep instead of trusting the curated audit list.

4. **VALUE aliases are incremental-safe; SYMBOL/TYPE/FILE renames are NOT (from the value-aliases observation).**
   - VALUE aliases (parser dual-accept, config dual-read, enum/namespace dual-accept, intake dual-verb) make value-consumer migrations green in isolation, because both old and new tokens are simultaneously valid, which is what makes a file-orthogonal a/b/c split work for value-consumer batches.
   - A renamed exported TS symbol / type / file has NO dual form: the old name stops existing and every importer breaks at `pnpm -r build` immediately. An `export { OldName } from '...'` shim is (a) an unratified new surface, (b) itself flagged by the leak scan, and (c) usually misses importers outside a single sub-batch's file set. So exported-symbol/file renames must be ATOMIC: definition + every importer in one commit.
   - Consequence for batch planning: before asserting "the alias covers this batch," CLASSIFY each identifier the batch touches: VALUE (aliasable, incremental, file-splittable) vs NAME/FILE (atomic, must move with full blast radius). A file-orthogonal a/b/c split only composes for the value layer; the symbol/file layer is its own atomic batch, ordered first so downstream value-consumer batches rebase cleanly.

5. **Three-surface distinction (from the 4c observation).** When reasoning about a rename's blast radius, keep three DIFFERENT surfaces apart: the RESOLVER-NAMESPACE (how a token is parsed/resolved), the ARTIFACT-TYPE (the on-disk/type identity), and the PROMOTE-ALIAS (a compatibility bridge kept for migration). Conflating them is what makes a single-lens audit under-count; naming them separately is the antidote.

Present these as a coherent rule set (short intro naming the pattern + the points above + a one-line "how to use this next time" checklist), not a chronological retelling of the episodes. The episodes are the provenance: link the four source observation notes by relative path so future readers can reach them via `git log` even after the observations are deleted.

After the finding stands on its own, these source observations are dischargeable (do NOT delete them from within this task — git-state transitions are the runner/human's job; just make sure the finding is self-contained so they CAN be deleted without loss):
- `work/notes/observations/prd-to-spec-4d-migrate-emit-sites-inserted-contract-sidecar-filepath-carveout-2026-07-10.md`
- `work/notes/observations/prd-to-spec-4e-residual-exported-symbols-inserted-2026-07-10.md`
- `work/notes/observations/prd-to-spec-value-aliases-are-not-symbol-aliases-exported-Prd-symbols-need-atomic-rename.md`
- `work/notes/observations/spec-migrate-4c-scope-decisions.md`

Out of scope: any code change, any ADR, touching the already-landed migrate tasks in `work/tasks/done/`, or the sibling `rename-expand-checklist.md` finding (that is `mint-rename-expand-checklist-finding`'s job — a DIFFERENT note about definitional mint/map surfaces; do not merge the two).

Acceptance:
- `work/notes/findings/rename-cutover-lessons.md` exists with the five-point rule set + a "how to use this next time" checklist + provenance links to the four observations.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green (docs-only, but the format:check gate still applies; run `pnpm format` first).

## Prompt

> You are building a single documentation-only finding that consolidates the durable lessons of the prd→spec rename cutover. Create exactly one new file, `work/notes/findings/rename-cutover-lessons.md`.
>
> Read these four observations first to source the material (use the Lesson/Decisions sections):
> - `work/notes/observations/prd-to-spec-4d-migrate-emit-sites-inserted-contract-sidecar-filepath-carveout-2026-07-10.md` (producer/consumer coupling + TYPE-vs-FILE identity split)
> - `work/notes/observations/prd-to-spec-4e-residual-exported-symbols-inserted-2026-07-10.md` (single-lens blind spot; three enumerations; the concrete leaked-symbol list)
> - `work/notes/observations/prd-to-spec-value-aliases-are-not-symbol-aliases-exported-Prd-symbols-need-atomic-rename.md` (value-alias vs symbol-alias; classify each identifier before splitting)
> - `work/notes/observations/spec-migrate-4c-scope-decisions.md` (resolver-namespace vs artifact-type vs promote-alias three-surface distinction)
>
> Skim a couple of neighbouring files in `work/notes/findings/` (e.g. `review-nonblocking-findings-disposition.md`, `slice-review-ci-advance-surfacing.md`) to match the house tone and frontmatter shape.
>
> Write ONE coherent rule set, not a chronological retelling. Structure it roughly:
> 1. Short intro naming the pattern ("a rename cutover has three coverage surfaces and one of them is DATA; value-aliasable vs atomic is the load-bearing classification").
> 2. Producer/consumer coupling (alias hides un-flipped producers until the contract step; enumerate producers and consumers separately).
> 3. TYPE identity vs on-disk FILE identity (the file-path alias outlives the type cutover and belongs to the data-migration command).
> 4. The three enumerations a coverage audit needs — value-consumers, value-producers + local unions, exported symbols via real `grep -rn "export.*Old"` (never a hand-curated list). Include the concrete leaked-symbol list from 4e. The contract-phase leak scan is the honest backstop.
> 5. Value-alias vs symbol/type/file rename: only the value layer is incrementally splittable; symbol/file renames are atomic (definition + every importer in one commit); classify each identifier before planning batches.
> 6. The resolver-namespace vs artifact-type vs promote-alias three-surface distinction (4c) — name the three surfaces so a single-lens audit doesn't conflate them.
> 7. A one-line "how to use this next time" checklist an author of a rename plan can copy.
> 8. A Provenance section linking all FOUR observation notes by relative path so the episodes stay reachable via git history after the notes are deleted.
>
> Do NOT mint an ADR (explicitly ruled out). Do NOT edit or delete the source observations (git-state transitions are the runner's job). Do NOT change any code. Do NOT touch the separate `rename-expand-checklist.md` finding — that is a different note about definitional mint/map surfaces, owned by another task.
>
> When done, run `pnpm format`, verify `pnpm -r build && pnpm -r test && pnpm format:check` is green, then stop. Do NOT perform any git operations.
