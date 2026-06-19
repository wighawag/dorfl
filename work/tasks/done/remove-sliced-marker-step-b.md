---
title: Remove the sliced: frontmatter marker entirely once prd-sliced/ is the sole source of truth — STEP B, the clean isolated breaking change (sequenced LAST)
slug: remove-sliced-marker-step-b
prd: slicing-coherence
blockedBy: [prd-sliced-folder-step-a]
covers: [12]
---

## What to build

The FINAL, sequenced-LAST slice of this PRD: now that `work/prd-sliced/` is the sole source of truth for sliced-ness (Step A landed and nothing READS the `sliced:` marker anymore), delete the marker entirely — a clean isolated breaking change, mirroring the `allowAgents→autoBuild` / `reviewPr→review` clean-rename precedent.

- Delete the `setSlicedMarker` WRITES (the release transition stops writing the derived `sliced:` copy).
- Drop `sliced` from the PRD frontmatter TYPE / parser (`frontmatter.ts`, `ledger-read.ts`'s `LedgerPrdItem.sliced`, any `ResolvePrdPool` plumbing).
- Remove the now-dead back-compat (any reader that still tolerated the marker as a fallback; after Step A they read the FOLDER, so the marker code is dead).
- Strip the `sliced:` marker from existing PRD files that still carry it (e.g. the backfilled ones in `prd-sliced/`) so the field is gone repo-wide.

  > FORWARD-POINTER (planted by the conductor after Step A landed, 2026-06-08): Step A flipped the readers to `prd-sliced/` residence but left TWO stale implementation doc-comments that still describe sliced-ness as "the `sliced:` marker" — `src/slicing-eligibility.ts` (the `slicedSlugs` doc: "resolved against the `sliced:` marker, NOT `work/done/`" + the `slicedSlugs` field comment "their `sliced:` marker is set") and `src/select-priority.ts` (the `slicedSlugs` field comment "whose PRD already carries a `sliced:` marker (resolves `sliceAfter`)"). Both files are runtime-correct (they consume the now-folder-derived `Set`); only the comments are stale. Step B's "no lingering `sliced:` marker references in any in-repo doc" sweep MUST include these two `src/` comments (re-word to "`prd-sliced/` residence"). Source nit: `work/observations/review-nits-prd-sliced-folder-step-a-2026-06-08.md` (#3).

- Update WORK-CONTRACT.md / `CONTEXT.md` / skills / ADRs that still DOCUMENT `sliced:` to describe `prd-sliced/`-residence as the sole sliced-ness signal (Step A pointed the glossary at the folder while keeping the marker as a derived copy; Step B removes any lingering mention of the marker).

Migration ordering is the whole point: Step A made the change non-breaking (folder canonical + marker as derived copy); Step B removes the cruft once it is provably unread. Do this ONLY after Step A; verify nothing reads `sliced:` before deleting.

## Acceptance criteria

- [ ] `setSlicedMarker` writes are gone; the release transition no longer writes a `sliced:` copy.
- [ ] `sliced` is removed from the frontmatter type/parser and the `ledger-read`/`ResolvePrdPool` plumbing; `grep` finds no live `sliced` frontmatter producer/consumer.
- [ ] Sliced-ness everywhere resolves via `prd-sliced/` residence only; `sliceAfter` / selection still work (regression: the ordering that resolved via the folder in Step A still resolves).
- [ ] Existing PRD files no longer carry a `sliced:` line.
- [ ] WORK-CONTRACT.md / CONTEXT.md / skills / ADRs document `prd-sliced/`-residence as the sole sliced-ness signal (no lingering `sliced:` marker references in any in-repo doc, including the CONTEXT.md glossary).
- [ ] Tests updated: nothing asserts the `sliced:` marker; folder-residence tests cover the prior marker tests' intent.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `prd-sliced-folder-step-a` — Step B is the second half of the two-step migration: the marker can only be deleted once the folder is the source of truth and every reader has been flipped (Step A). Removing it before Step A would break sliced-ness resolution.

## Prompt

> Remove the `sliced:` PRD frontmatter marker ENTIRELY — Step B of the two-step migration in `work/prd/slicing-coherence.md` (US #12), the clean isolated breaking change sequenced LAST. Mirror the `allowAgents→autoBuild` / `reviewPr→review` clean-rename precedent (`work/done/rename-reviewpr-to-review.md`): a deletion, no back-compat.
>
> PRECONDITION (drift check FIRST): Step A (`prd-sliced-folder-step-a`) MUST have landed — `work/prd-sliced/` is the source of truth and the `slicedSlugs` builders (`slicing.ts:readSlicedSlugs`, `ledger-read.ts`'s PRD pool) already read FOLDER residence, with `sliced:` only a derived copy. Verify NOTHING reads the marker anymore before deleting. If Step A has not landed, or a reader still consults the marker for truth, route this slice to `needs-attention/` (its blocker is not done) rather than removing a still-load-bearing field.
>
> DELETE: `setSlicedMarker` writes in the release transition (`src/slicing-lock.ts` / wherever Step A left the derived-copy write); `sliced` from the frontmatter type
>
> - parser (`src/frontmatter.ts`), from `src/ledger-read.ts` (`LedgerPrdItem.sliced`, the `ResolvePrdPool` plumbing), and any dead back-compat fallback; the `sliced: <date>` line from any PRD files that still carry it (including backfilled ones in `prd-sliced/`). Update `skills/to-slices/WORK-CONTRACT.md`, `CONTEXT.md` (any lingering `sliced:` marker mention — Step A already pointed the `sliceAfter` glossary entry at the folder),
> - skills/ADRs that document `sliced:` to name `prd-sliced/`-residence as the sole signal. (Note: the `to-slices` SKILL itself describes setting `sliced:` in its step 6 — coordinate that doc with the maintainer's skills tree; the in-repo WORK-CONTRACT copy is in scope.)
>
> "Done" = `grep` finds no live `sliced` frontmatter producer/consumer, sliced-ness resolves only via `prd-sliced/` residence, existing files have no `sliced:` line, docs (incl. CONTEXT.md) updated, tests green, and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
