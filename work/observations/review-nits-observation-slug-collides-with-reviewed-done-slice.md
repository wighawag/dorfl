---
title: the review-gate mints work/observations/review-nits-<slug>-<date>.md with frontmatter slug:<reviewed-slice-slug> — so the observation's identity slug COLLIDES with the (now-done) reviewed slice and does NOT match its own filename
type: observation
status: spotted
spotted: 2026-06-17
slug: review-nits-observation-slug-collides-with-reviewed-done-slice
---

## What was seen

The review gate (Gate 2 approve with non-blocking nits) writes a per-run observation at:

- **filename:** `work/observations/review-nits-<reviewed-slug>-<YYYY-MM-DD>.md`
- **frontmatter:** `slug: <reviewed-slug>` (the slug of the SLICE that was reviewed)

So the observation's frontmatter `slug:` is NOT its own filename, and it is IDENTICAL to the reviewed slice's slug. Once that slice lands in `work/done/`, the observation's `slug:` collides with a done slice of the same slug.

Verified at the minting site `src/integration-core.ts` ~L1697:

```
const filename = `review-nits-${params.slug}-${date}.md`;
writeFileSync(join(obsDir, filename),
  renderReviewNitsObservation({slug: params.slug, date, nits}));
```

and `renderReviewNitsObservation` emits `slug: ${params.slug}` in the frontmatter (a deliberate "back-pointer to the run it came from", per its doc comment).

## Why it matters

The `slug:` was intended as a BACK-POINTER (which run produced these nits), but the lifecycle/ledger read seam treats frontmatter `slug:` as the observation's IDENTITY (`fm.slug ?? basename(file)` in `src/ledger-read.ts`). That makes the identity:

- **non-round-tripping** — `obs:<frontmatter-slug>` does not resolve back to `review-nits-<slug>-<date>.md` (`findItemPath` searches by filename). This is the hard failure recorded in the sibling observation `triage-leg-fails-when-observation-frontmatter-slug-differs-from-filename.md` (the ~33-leg CI matrix wall of "could not find its item file").
- **colliding** — `obs:advance-in-place-publishes-treeless-results` (an observation) shares a slug with the done slice `advance-in-place-publishes-treeless-results`. Any slug-anywhere resolution could grab the wrong file/namespace.

## Suggested fix shape (decide when slicing)

Make the review-nits observation's IDENTITY its own filename, not the reviewed slug. Either:

- DROP the `slug:` frontmatter from the minted observation (let identity fall back to `basename(file)` = `review-nits-<slug>-<date>`), and move the reviewed-slug into a CLEARLY DIFFERENT field (e.g. `reviewOf: <slug>` / `sourceRun: <slug>`) so it stays a back-pointer without claiming identity; OR
- set `slug: review-nits-<slug>-<date>` (filename-matching) and carry the back-pointer separately.

Coordinate with the code fix in the sibling observation (enumerate/resolve must agree on the slug key, and an unresolvable triage leg should skip benignly). Fixing only ONE side leaves the other half of the round-trip broken.

NOTE: this is a DATA + minting-contract defect; the sibling observation is the corresponding CODE defect (the resolution mismatch). They should likely be ONE slice (or two tightly-coupled ones) so the round-trip is made total on both ends at once.

## Refs

- Minting: `src/integration-core.ts` ~L1697 (`review-nits-${slug}-${date}.md` + `renderReviewNitsObservation` emitting `slug:`).
- Identity read: `src/ledger-read.ts` `readLocalObservations` (`fm.slug ?? basename(file)`).
- The failing round-trip: `src/advance.ts` `findItemPath` (~L718).
- Concrete colliding pairs on origin/main (2026-06-17): every `review-nits-*` observation vs its same-named done slice (e.g. `advance-in-place-publishes-treeless-results`, `install-ci-core-and-github-adapter`).
