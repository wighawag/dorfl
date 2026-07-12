---
promotedFrom: observation:prd-to-spec-value-aliases-are-not-symbol-aliases-exported-Prd-symbols-need-atomic-rename
---

## What to build

A single documentation edit: extend the shared cutover-lessons note under `work/notes/findings/` (the same note that already collects the 4d/4e C-audit lessons from the prd→spec cutover) with a new section capturing the **value-alias vs symbol-alias distinction** surfaced by the 4a re-scoping incident.

The distinction to record (paraphrased from the source observation, keep the wording tight and reusable — this is guidance for FUTURE cutovers, not a history of prd→spec):

- **VALUE aliases are incremental-safe.** When the alias mechanism is at the value level (parser accepts both tokens, config reads both keys, a namespace/enum accepts both strings, intake accepts both verbs), a consumer that switches from reading the old token to reading the new one — or is widened to accept both — stays green in isolation, because BOTH values are simultaneously valid. This is what makes a file-orthogonal a/b/c split work for value-consumer batches.
- **SYMBOL / TYPE / FILE-IDENTITY renames are NOT incremental-safe.** A renamed exported TS symbol (or a renamed file / renamed type) has no dual form: the old name simply stops existing, and every importer breaks at `pnpm -r build` immediately. Adding an `export { OldName } from '...'` shim to bridge it is (a) an unratified new surface, (b) itself something the cutover's leak-scan will flag, and (c) usually doesn't cover importers that live outside any single sub-batch's file set. Therefore exported-symbol / file renames must be done ATOMICALLY: the definition and every importer land in one commit.
- **Consequence for batch planning / C-audit-style "every batch green in isolation" reasoning.** Before asserting a batch is green-in-isolation via "the alias covers it," CLASSIFY each identifier the batch touches: is it a VALUE (aliasable, incremental) or a NAME/FILE (must move atomically with its full blast radius)? A file-orthogonal a/b/c split only composes for the value layer; the symbol/file layer must be its own atomic batch, ordered first so subsequent value-consumer batches can rebase cleanly.

Also cross-reference (one-line link/mention) the reusable-cutover-pattern idea note if it exists, so the distinction is discoverable from both directions. Do NOT mint a separate ADR — the human explicitly ruled that out.

After the note edit lands green, DELETE the source observation `work/notes/observations/observation-prd-to-spec-value-aliases-are-not-symbol-aliases-exported-Prd-symbols-need-atomic-rename.md` (the operational residue is discharged now that 4a/b/c have landed; the reusable guidance survives in the cutover-lessons note).

Scope guard: this task is documentation-only. No source code changes, no protocol changes, no skill-doc changes beyond the cutover-lessons note itself.

## Prompt

> Extend the shared cutover-lessons note under `work/notes/findings/` (the one already collecting the 4d/4e C-audit lessons from the recent prd→spec rename — locate it with `ls work/notes/findings/` and grep for `C-audit` / `cutover` / `4d` / `4e`) with a new section that records the **value-alias vs symbol-alias distinction**:
>
> 1. Value aliases (parser dual-accept, config dual-read, enum/namespace dual-accept, intake dual-verb) make value-consumer migrations incrementally green in isolation, because both old and new tokens are simultaneously valid.
> 2. Symbol renames, type renames, and file renames have no dual form: the old name vanishes, so every importer breaks at `pnpm -r build` on the same commit. They must be done ATOMICALLY (definition + every importer in one commit). Adding an `export { OldName } from ...` shim is not a real substitute — it is an unratified new surface, it trips the cutover's leak-scan, and it usually doesn't cover importers outside any single sub-batch's file set.
> 3. Therefore, when planning a rename cutover or running a C-audit-style "every batch stays green in isolation" review, first CLASSIFY each identifier the batch touches: VALUE (aliasable, incremental, splittable by file) vs NAME/FILE (atomic, must move with full blast radius). A file-orthogonal a/b/c split only composes for the value layer; the symbol/file layer is its own atomic batch and should be ordered first so downstream value-consumer batches rebase cleanly.
>
> Keep the wording tight and future-facing — this is reusable guidance for the next cutover, not a history of prd→spec. If a reusable-cutover-pattern idea note exists under `work/notes/`, add a one-line cross-reference between the two so the distinction is discoverable from either side. Do NOT mint an ADR (explicitly ruled out) and do NOT touch any source code or protocol/skill docs.
>
> Then DELETE the source observation file `work/notes/observations/observation-prd-to-spec-value-aliases-are-not-symbol-aliases-exported-Prd-symbols-need-atomic-rename.md` — 4a/b/c have already landed, the operational residue is discharged, and the reusable guidance now lives in the cutover-lessons note.
>
> Green gate: `pnpm -r build && pnpm -r test && pnpm format:check` must pass. Because this is docs-only, the build/test should be unaffected; `pnpm format` before the check if needed.