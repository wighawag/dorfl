---
title: an observation's IDENTITY must be its own filename, never a foreign slug — fix the review-nits minting (slug → reviewOf back-pointer), make the triage enumerate/resolve round-trip TOTAL, make an unresolvable lifecycle leg a benign SKIP not exit-1, and MIGRATE the 17 existing review-nits observations
slug: observation-identity-is-its-filename-not-a-foreign-slug
origin: observation
blockedBy: []
covers: []
---

## What to build

Make an observation's lifecycle IDENTITY round-trip cleanly through the `advance`
triage path, so an `obs:<slug>` leg ALWAYS resolves back to its own file. Today it
does not: the CI lifecycle propose matrix (~33 legs) produced a wall of

```
advance classified the 'triage' rung for observation:<slug> but could not find
its item file under work/ — a human must reconcile the item's location. (exit 1)
```

for every `review-nits-*` observation. Two coupled defects cause it (both VERIFIED,
see the source observations) and they MUST be fixed together, or the round-trip
stays half-broken:

### Defect 1 — the review-nits minting gives an observation a FOREIGN identity slug

`integration-core.ts` (~L1697 + `renderReviewNitsObservation` ~L1721) writes the
review-nits observation as:

- filename `work/observations/review-nits-<reviewed-slug>-<date>.md`
- but frontmatter `slug: <reviewed-slug>` (the REVIEWED SLICE's slug, intended as a
  back-pointer "which run produced these nits").

So the observation's `slug:` is NOT its own filename AND collides with the reviewed
slice (which lands in `work/done/`). The `slug:` is documentary only — nothing reads
it programmatically as a back-pointer (verified) — so it is safe to change.

FIX: stop claiming identity with a foreign slug. An observation's identity is its
FILENAME. Carry the back-pointer in a clearly-different field. DECIDED direction
(ratify while building): emit `reviewOf: <reviewed-slug>` (the back-pointer) and do
NOT emit a `slug:` line at all (so identity falls back to `basename(file)` =
`review-nits-<reviewed-slug>-<date>`, the existing fallback in `ledger-read.ts`).
This keeps "what is this observation about?" expressible WITHOUT the identity
collision. (If a reader prefers an explicit `slug:`, it must equal the filename
stem — never a foreign slug; pick one and record it.)

### Defect 2 — enumerate and resolve disagree on the observation slug KEY

- ENUMERATE (`ledger-read.ts` `readLocalObservations`/`readMirrorObservations`
  ~L380): slug = `fm.slug ?? basename(file)` — frontmatter WINS.
- RESOLVE (`advance.ts` `findItemPath` ~L718): looks ONLY for
  `work/observations/<slug>.md` by FILENAME, never frontmatter.

When the two differ (Defect 1's data), the matrix emits `obs:<frontmatter-slug>`
but `findItemPath` searches `work/observations/<frontmatter-slug>.md` → miss →
exit 1. Even AFTER Defect 1 is fixed, the two halves must be made to AGREE so a
future foreign-slug can never re-break the round-trip.

FIX: make the enumerate/resolve keying TOTAL. Once observation identity is the
filename (Defect 1), the simplest invariant is: the lifecycle pool emits the
FILENAME-derived slug for observations, and `findItemPath` resolves observations by
that same filename. (If frontmatter-slug resolution is kept for robustness, add a
`findObservationFileBySlug` mirroring the existing `findPrdFileBySlug` so a
renamed-but-frontmatter-matching file still resolves — but do NOT leave the two
halves keyed differently.)

### Defect 3 — an unresolvable lifecycle leg is a hard exit-1, not a benign skip

`findItemPath` returning `undefined` makes the triage rung (`advance.ts` ~L568),
and the same guard on surface (~L475) + apply (~L637), return
`exitCode: 1, outcome: 'usage-error'` "a human must reconcile". A slug that
resolved at ENUMERATE-time but is gone/relocated by RUN-time is EXPECTED under
cross-tick parallelism (it may have been triaged/settled/deleted by a sibling leg),
so at matrix scale this is a wall of red for a calm condition.

FIX: an unresolvable lifecycle leg (the item vanished between enumerate and run)
must be a BENIGN SKIP (a clean no-op outcome, exit 0 or a distinct non-error
"skipped/vanished" outcome the matrix tolerates), NOT a needs-human exit-1. Keep a
genuinely-malformed invocation (a bare typo'd slug a human typed) loud if it is
distinguishable; an auto-enumerated leg that lost its file is a skip.

### Defect 4 — migrate the 17 existing review-nits observations

The 17 `review-nits-*` observations currently on `work/observations/` carry the
foreign `slug:`. Rewrite each to the new scheme (drop `slug:` / add
`reviewOf:`), so they round-trip and no longer collide with their done slices.
(Exactly 17 of 33 observations mismatch — all `review-nits-*`; the other 16 already
have identity = filename or no slug.) Observations are APPEND-ONLY for their BODY,
but this is a frontmatter identity correction, not a rewrite of the captured signal
— do it as a targeted frontmatter edit and note it.

## Acceptance criteria

- [ ] The review-nits minting (`integration-core.ts`) no longer writes a foreign
      `slug:`; it writes the back-pointer as `reviewOf: <reviewed-slug>` (or the
      ratified equivalent) and the observation's identity is its filename. A unit
      test on `renderReviewNitsObservation` pins the new frontmatter.
- [ ] The triage enumerate→resolve round-trip is TOTAL for observations: a freshly
      minted review-nits observation, enumerated into the lifecycle pool, resolves
      back to its own file via `findItemPath` (no "could not find its item file").
      A test drives enumerate (`gatherLifecycleInPlace`/scan) → the emitted
      `obs:<slug>` → `findItemPath` and asserts it resolves.
- [ ] An `obs:<slug>` (or `slice:`/`prd:`) leg whose item VANISHED between enumerate
      and run is a BENIGN SKIP (no-op outcome the matrix tolerates), NOT exit-1
      "a human must reconcile". A test pins the vanished-item skip on the triage
      rung (and the surface + apply rungs share the fix).
- [ ] No identity COLLISION: an observation's resolved lifecycle slug never equals a
      DIFFERENT-namespace item's slug by construction (the review-nits obs no longer
      borrows the reviewed slice's slug). A test asserts a minted review-nits obs for
      a done slice does not collide.
- [ ] The 17 existing `work/observations/review-nits-*.md` files are migrated to the
      new identity scheme (drop foreign `slug:` / add `reviewOf:`), verified to
      round-trip (each resolves to its own file; none collides with a done slice).
- [ ] With `observationTriage` ON (e.g. via the dispatch override from
      `advance-lifecycle-dispatch-gate-inputs`, OR a forced gate in a test), the
      triage legs for the migrated observations no longer fail — END-TO-END proof the
      bug is closed. (This slice + that one together restore safe triage; this slice
      does NOT itself re-enable triage in `.dorfl.json`.)
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None — can start immediately. (Independent of, but COMPLEMENTARY to,
  `advance-lifecycle-dispatch-gate-inputs`: that slice gives the dispatch override
  used to TEST re-enabled triage here; it is not a hard dependency.)

## Prompt

> FIRST, drift-check against current `origin/main`: re-read the three source
> observations — `work/observations/triage-leg-fails-when-observation-frontmatter-slug-differs-from-filename.md`,
> `work/observations/review-nits-observation-slug-collides-with-reviewed-done-slice.md`
> (the slug defects) — and confirm the code still matches: `src/integration-core.ts`
> (~L1697 minting + `renderReviewNitsObservation` ~L1721, emitting `slug: <reviewed-slug>`);
> `src/ledger-read.ts` (`readLocalObservations`/`readMirrorObservations` ~L380, slug =
> `fm.slug ?? basename(file)`); `src/advance.ts` (`findItemPath` ~L718 filename-only;
> the triage ~L568 / surface ~L475 / apply ~L637 rungs that exit-1 when it returns
> undefined); and the existing `findPrdFileBySlug` (`ledger-read.ts` ~L412) as the
> frontmatter-aware-resolution PATTERN if you keep frontmatter resolution. Confirm
> nothing reads an observation's `slug:` as a programmatic back-pointer (it is
> documentary), so changing it is safe. If a fix already landed, route to
> needs-attention noting that.
>
> GOAL: make an observation's lifecycle IDENTITY its own FILENAME, end-to-end, so an
> `obs:<slug>` triage leg ALWAYS round-trips to its file. Four coupled changes
> (do them together — fixing one leaves the round-trip half-broken): (1) MINTING —
> stop writing a foreign `slug:` in review-nits observations; write `reviewOf:
> <reviewed-slug>` and let identity = filename. (2) KEYING — make enumerate
> (`ledger-read`) and resolve (`findItemPath`) AGREE on the observation slug key
> (filename-as-identity is the simplest; if you keep frontmatter resolution, add a
> `findObservationFileBySlug` so both halves agree). (3) SKIP — an auto-enumerated
> lifecycle leg whose item VANISHED between enumerate and run is a BENIGN SKIP, not
> exit-1 "a human must reconcile" (applies to triage + surface + apply). (4)
> MIGRATE the 17 existing `review-nits-*` observations to the new identity scheme.
>
> DECISION TO RATIFY (record in `## Decisions`): the back-pointer field name
> (`reviewOf` vs `about` vs `sourceRun`) and whether to DROP `slug:` (identity =
> filename fallback) or set `slug: <filename-stem>`. The slice's steer is `reviewOf`
> + no `slug:`. Also pin the "vanished-leg" SKIP outcome shape (a new benign outcome
> vs exit-0) and how it stays distinguishable from a genuinely-malformed
> human-typed slug.
>
> WHY: the CI lifecycle propose matrix (`ci-propose-matrix-enumerates-lifecycle-items`,
> just landed) routed the triage pool through ~33 parallel legs and EVERY
> review-nits observation failed to resolve — see the three source observations.
> `observationTriage` is currently `off` in `.dorfl.json` as a STOPGAP; this
> slice is the real fix. Do NOT re-enable triage in the committed config here (that
> is a separate human decision once this lands).
>
> SEAM TO TEST AT: the enumerate→resolve round-trip with throwaway repos — (a) a
> minted review-nits obs enumerates + resolves to its own file; (b) a vanished item
> is a benign skip, not exit-1; (c) no cross-namespace slug collision; (d) the 17
> migrated files each round-trip. Plus the `renderReviewNitsObservation` unit test
> for the new frontmatter. Throwaway `--bare`/working-tree fixtures; temp dirs; no
> network.
>
> DONE: an observation's identity is its filename, the triage round-trip is total,
> a vanished lifecycle leg skips benignly (no needs-human wall), the 17 existing
> review-nits observations are migrated + round-trip + no longer collide with their
> done slices, `## Decisions` records the back-pointer-field + skip-outcome choices,
> and `pnpm -r build && pnpm -r test && pnpm format:check` is green. Do NOT perform
> git transitions (no stage/commit/push, no folder moves) — the runner/human owns
> those.

## Decisions (to record while building)

- The back-pointer field name (`reviewOf` steer) and the drop-`slug:` vs
  `slug:=filename-stem` choice for observation identity.
- The "vanished lifecycle leg" benign-SKIP outcome shape, and how it stays
  distinguishable from a genuinely-malformed human-typed `obs:<slug>` (loud) vs an
  auto-enumerated leg that lost its file (skip).
- Whether `findItemPath` keeps filename-only resolution (relying on identity =
  filename) or gains frontmatter-aware `findObservationFileBySlug` parity with
  `findPrdFileBySlug` — and why.
