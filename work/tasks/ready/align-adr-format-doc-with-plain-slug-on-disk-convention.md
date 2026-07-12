---
promotedFrom: observation:review-nits-pin-frontmatter-owns-fence-to-heading-blank-line-convention-2026-07-07
---

## What to build

Update `ADR-FORMAT.md` so it describes the plain-slug filename convention that all existing ADRs in `docs/adr/` actually follow, rather than the `0001-slug.md` sequential-numbering scheme it currently prescribes.

Context / why:

- Review of the `pin-frontmatter-owns-fence-to-heading-blank-line-convention` task surfaced a nit: the new ADR `docs/adr/frontmatter-owns-fence-to-heading-blank-line.md` uses a plain slug, not the `0001-slug.md` form that `work/protocol/ADR-FORMAT.md` prescribes.
- Revealed preference is unambiguous and decisive: all 22 existing ADRs under `docs/adr/` use plain-slug filenames; ZERO use numeric prefixes. The on-disk convention has already won in practice.
- Numbering adds ordering / merge-conflict friction for little benefit; a slug is self-describing.
- Per this repo's AGENTS.md, protocol docs have a source of truth (`skills/setup/protocol/`) and a propagated copy (`work/protocol/`). BOTH must change and stay byte-identical, otherwise the next `setup` run silently reverts this fix in every downstream target repo.

Concrete changes:

1. In `skills/setup/protocol/ADR-FORMAT.md` (source of truth): rewrite the numbering line — currently roughly `ADRs live in \`docs/adr/\` and use sequential numbering: \`0001-slug.md\`, \`0002-slug.md\`, etc.` — to describe the plain-slug convention instead. Suggested wording: "ADRs live in `docs/adr/` and are named with a plain kebab-case slug describing the decision (e.g. `frontmatter-owns-fence-to-heading-blank-line.md`). No numeric prefix — ordering lives in git history, not in the filename." Adjust surrounding prose if it references numbering elsewhere in the file.
2. Mirror the SAME edit byte-identically into `work/protocol/ADR-FORMAT.md` (the propagated copy for this repo's own use).
3. Verify with `diff -r skills/setup/protocol work/protocol` — the two ADR-FORMAT.md files must be byte-identical after the change (only files that legitimately live in just one side may differ).
4. Do NOT rename any existing ADR file. Do NOT touch `docs/adr/`. This task is purely a protocol-doc alignment.

Out of scope / explicitly NOT doing:

- Not amending the landed `pin-frontmatter-owns-fence-to-heading-blank-line-convention` done record to add the convention-choice note its Done-when asked for. That nit was accepted-as-is (the sibling `intake-adopts-renderer` task already cross-references the ADR); retro-editing landed done records is high-friction for low gain.
- Not renumbering or renaming any existing ADRs.

## Done-when

- `skills/setup/protocol/ADR-FORMAT.md` no longer prescribes `0001-slug.md` numbering and instead describes the plain-slug convention.
- `work/protocol/ADR-FORMAT.md` contains the exact same updated text (byte-identical to the source-of-truth copy).
- `diff skills/setup/protocol/ADR-FORMAT.md work/protocol/ADR-FORMAT.md` is empty.
- Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check` (run `pnpm format` first if needed).

## Prompt

> Update `ADR-FORMAT.md` in this repo so it matches the plain-slug filename convention that all 22 existing ADRs under `docs/adr/` already use, instead of the `0001-slug.md` sequential-numbering scheme it currently prescribes. Revealed preference is decisive (0 of 22 ADRs are numbered) and the review of the recent `pin-frontmatter-owns-fence-to-heading-blank-line-convention` task flagged the mismatch.
>
> There are TWO copies of this doc and BOTH must change: `skills/setup/protocol/ADR-FORMAT.md` is the source of truth (this is what `setup` copies into every target repo's `work/protocol/`), and `work/protocol/ADR-FORMAT.md` is the propagated copy for this repo's own use. Edit the source first, then mirror the exact same bytes into the `work/` copy. After your edits, `diff skills/setup/protocol/ADR-FORMAT.md work/protocol/ADR-FORMAT.md` must be empty.
>
> Rewrite the numbering sentence (currently: "ADRs live in `docs/adr/` and use sequential numbering: `0001-slug.md`, `0002-slug.md`, etc.") to say something like: "ADRs live in `docs/adr/` and are named with a plain kebab-case slug describing the decision (e.g. `frontmatter-owns-fence-to-heading-blank-line.md`). No numeric prefix — ordering lives in git history, not in the filename." Scan the rest of the file and adjust any other prose that assumes numbering.
>
> Do NOT rename any existing ADR file. Do NOT touch `docs/adr/`. Do NOT amend any landed done records. This is purely a protocol-doc alignment.
>
> Finish by running `pnpm format` then verifying `pnpm -r build && pnpm -r test && pnpm format:check` is green. Do not perform any git operations — the runner owns those.
