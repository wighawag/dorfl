---
promotedFrom: observation:prd-to-spec-4d-migrate-emit-sites-inserted-contract-sidecar-filepath-carveout-2026-07-10
---

## What to build

Create ONE new file `work/notes/findings/rename-cutover-lessons.md` that folds together the two durable lessons from the 4d and 4e observations into a single reusable rule about namespace/enum-value cutovers. This is a documentation-only task — no code changes, no ADR. The human ratified (2026-07-10) that this material belongs in `work/notes/findings/`, NOT in `docs/adr/`.

The finding must cover, in the finding's own voice (not just quoted blocks):

1. **Producer/consumer cutover coupling (from the 4d observation).** For a namespace/enum-value cutover, "migrate the consumers" is TWO jobs: widen CONSUMER `=== 'old'` checks (green on the alias), AND flip PRODUCER emit-site values + local union DEFINITIONS. The alias makes the consumer-widen green in isolation, which HIDES un-flipped producers — the build passes, so an audit that only asks "does it stay green?" misses them. The producer flip is only forced at the CONTRACT step (alias removal) or by an identifier leak scan. Enumerate PRODUCERS and CONSUMERS separately.

2. **TYPE identity vs on-disk FILE identity (from the 4d observation).** When a value also keys an on-disk FILE (sidecar/lock), the producer flip is DATA-coupled: flipping the emitted value changes which file is read, so the file-path alias must OUTLIVE the type-value cutover and belongs to the data-migration command. The TYPE-member `'old'` is SOURCE (removed by the contract task); the on-disk FILENAME `old-<slug>.md` is DATA (converted + fallback removed by the migration command). Separate these two identities in the plan.

3. **The C-audit's single-lens blind spot (from the 4e observation, twice-confirmed).** A coverage audit that maps a rename by ONE lens (e.g. `namespace === 'old'` consumer sites) is blind to at least two other surfaces: PRODUCER emit-sites + local unions (→ caught by 4d), and exported `Old*` SYMBOLS/types/fields that are neither a namespace consumer nor on a hand-curated list (→ caught by 4e). A rename cutover coverage audit needs THREE separate enumerations: (1) VALUE consumers (`=== 'old'`, alias-covered, incremental); (2) VALUE producers (emit-sites + local union definitions, must be flipped or the alias hides them); (3) exported SYMBOLS/types/fields (no alias, atomic rename, enumerated by `grep "export.*Old"` — NOT a hand-curated list). The contract-phase drift-check / leak scan is the honest backstop that caught both blind spots precisely because it forces a real grep instead of trusting the curated audit list.

Present these as a coherent rule set (short intro + the three points + a one-line "how to use this next time" checklist), not as a chronological retelling of the 4d/4e episodes. The episodes themselves are the provenance (link the two observation notes by relative path so future readers can reach them via `git log` even after the observations are deleted).

After the finding file is written, the two source observations are dischargeable:
- `work/notes/observations/prd-to-spec-4d-migrate-emit-sites-inserted-contract-sidecar-filepath-carveout-2026-07-10.md`
- `work/notes/observations/prd-to-spec-4e-residual-exported-symbols-inserted-2026-07-10.md`

Do NOT delete them from within this task (git-state transitions are the runner/human's job). Just make sure the finding stands on its own so the observations CAN be deleted without loss.

Acceptance:
- `work/notes/findings/rename-cutover-lessons.md` exists with the three-point rule set + provenance links.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green (this is a docs-only change, but the format:check gate still applies).

## Prompt

> You are building a documentation-only finding. Create exactly one new file, `work/notes/findings/rename-cutover-lessons.md`, that folds the durable lessons from two sibling observations into a single reusable rule for namespace/enum-value rename cutovers.
>
> Read these two observations first to source the material verbatim where useful:
> - `work/notes/observations/prd-to-spec-4d-migrate-emit-sites-inserted-contract-sidecar-filepath-carveout-2026-07-10.md` (Lesson section: producer/consumer coupling + TYPE-vs-FILE identity split)
> - `work/notes/observations/prd-to-spec-4e-residual-exported-symbols-inserted-2026-07-10.md` (Lesson section: the C-audit's single-lens blind spot, three enumerations needed)
>
> Also skim a couple of neighbouring files in `work/notes/findings/` (e.g. `review-nonblocking-findings-disposition.md`, `slice-review-ci-advance-surfacing.md`) to match the house tone and frontmatter shape for that folder.
>
> Write the finding as ONE coherent rule set, not a chronological retelling. Structure it roughly as:
> 1. Short intro naming the pattern ("rename-cutover coverage has three surfaces, and one of them is data").
> 2. Point A — producer/consumer coupling (the alias hides un-flipped producers until the contract step; enumerate producers and consumers separately).
> 3. Point B — TYPE identity vs on-disk FILE identity (when a value keys a file, the file-path alias outlives the type cutover and belongs to the data-migration command, not the contract task).
> 4. Point C — the single-lens audit blind spot (a rename needs THREE enumerations: value-consumers, value-producers + local unions, exported symbols by real `grep "export.*Old"`; a hand-curated list is not one of the three). The contract-phase leak scan is the honest backstop.
> 5. A one-line "how to use this next time" checklist an author of a rename plan can copy.
> 6. A Provenance section linking both observation notes by relative path so the episodes remain reachable via git history after the notes are deleted.
>
> Do NOT mint an ADR — the human explicitly ruled that out. Do NOT edit or delete the two source observations (git-state transitions are the runner's job). Do NOT change any code.
>
> When you are done, verify `pnpm -r build && pnpm -r test && pnpm format:check` is green (run `pnpm format` first if needed), then stop.
