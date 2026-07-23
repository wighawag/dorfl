---
title: 'slicing-coherence — make do prd:<slug> a first-class do rung — integrate through performIntegration (propose/PR), mirror the build review model, and give PRDs the same folder lifecycle as slices (spec/ → slicing/ → spec-sliced/)'
slug: slicing-coherence
sliceAfter: [auto-slice]
---

> Launch snapshot \u2014 records intent at creation, NOT maintained. Current truth: `docs/adr/` + the code; remaining work: `work/backlog/` slices. The technical-detail sections are trimmed by `to-slices` once sliced.
>
> **Source:** a design session during the `do spec:advance-loop` test-drive (2026-06-08). Background + the corrected model: `work/observations/slice-output-bypasses-integration-vs-build.md` and the `## DECIDED 2026-06-08` section of `work/ideas/folder-taxonomy-and-prd-edit-handshake.md`. Every seam here is RESOLVED \u2014 hence non-`humanOnly` (dogfood-able by auto-slice).
>
> **This SPEC is a PRECURSOR to `work/spec/advance-loop.md`** and must be sliced + built FIRST: advance-loop's substrate-agnostic tick assumes (a) ONE integrate back-half for every rung \u2014 including the slice rung \u2014 and (b) a coherent sliced-SPEC model. advance-loop's `sliceAfter` is updated to include this SPEC.

## Problem Statement

`do prd:<slug>` (the slicing rung) is supposed to be \"just another `do` rung,\" but today it is the ODD ONE OUT in three coupled ways, and the inconsistencies block the advance-loop design that wants one uniform tick over every rung:

1. **Slice OUTPUT bypasses integration.** `do slice:<slug>` runs its code output through `performIntegration` (`src/integration-core.ts`) \u2014 honoring `--propose` (push the work branch + open a PR) / `--merge` (land on `main`). `do prd:` does NOT: it commits the produced `work/backlog/*` slices STRAIGHT to `main` via `releaseSlicingLock`'s `emitSlices`/`markSliced` and its doc-comment explicitly says it \"does NOT call `performIntegration`.\" So slicing has **no propose mode, no PR option** \u2014 CI cannot put slices in a PR (advance-loop US #27 wants a propose-mode matrix where each job opens a PR; a SPEC-slice job cannot today).

2. **The slice review model is weaker / inconsistent with build.** The build path is `improve \u2192 Gate-2 review-before-integrate \u2192 integrate`. The slice path has only the in-context improver loop (`slicer-review-loop.ts`), and that loop's prompt reviews slices WITHOUT a whole-SET lens (graph coherence, gaps, overlap, \"does the set compose into the SPEC goal\") \u2014 even though the `review` skill already HAS a \"set of slices\" mode. There is no fresh-context acceptance gate before the slices land (the slice-path analogue of build's Gate-2).

3. **PRDs do not flow like slices.** A human can glance at `backlog/` to see \"what needs building,\" but cannot glance at a folder to see \"what PRDs need slicing\": sliced-ness is a frontmatter `sliced:` marker, not a folder. PRDs lack the `done/`-analogue resting folder that every other work item has.

NOTE what is NOT a problem (do not \"fix\" it): the slicing LOCK on `main` is CORRECT \u2014 it is the same ledger-write CAS as the build CLAIM (move-into-a-status-folder on the visibility ref; see `docs/adr/claim-ledger-vs-protected-main.md`). Keep it.

## Solution

Make `do prd:<slug>` a first-class `do` rung along three axes, each mirroring the build path exactly:

- **Output through the shared core.** Route slice output through `performIntegration` so `do prd:` honors `--propose`/`--merge` (and the agent's slicing work runs in-place-on-a-branch like `do slice:` \u2014 branch \u2260 worktree; the isolation seam decides). This makes \"all `do slice:` args apply to `do prd:`\" true BY CONSTRUCTION \u2014 integrate-time args resolve once, in the shared core.
- **Same review model.** Two distinct, independently-controllable review concepts: the existing improver loop (now reviewing the whole SET; the `--slicer-loop-*` family: `--no-slicer-loop` / `--slicer-loop-max` / `--slicer-loop-model`) AND a fresh-context acceptance gate (the build `--review-*` family) (`--review`/`--no-review`, slice-SET prompt) riding `performIntegration`'s review-before-integrate.
- **Same folder lifecycle.** PRDs flow `spec/` (to-slice) \u2192 `slicing/` (locked, exists) \u2192 `spec-sliced/` (sliced, resting) \u2014 the build machine minus `done/`. The folder becomes the source of truth; `sliced:` becomes a derived copy, then is removed entirely in a final sequenced slice.

This is almost entirely REUSE: `performIntegration` (landed), the `review` skill's set-of-slices mode (exists), the existing slicing lock + folders, the build path's flag taxonomy.

## User Stories

1. As a maintainer / CI, I want `do prd:<slug>` to honor `--propose` (push a branch
   - open a PR with the produced slices) and `--merge` (land on `main`), exactly like `do slice:<slug>`, so that slices can be reviewed in a PR before they land.
2. As a maintainer, I want EVERY `do slice:<slug>` arg to also apply to `do prd:<slug>` (resolved in the shared integrate core, not duplicated), so the two rungs are one surface with one behaviour.
3. As a maintainer, I want the slicer improver loop to review the WHOLE SET of produced slices (dependency graph, gaps, overlap, \"does the set compose into the SPEC goal\"), not just per-slice well-formedness, so set-level defects are caught.
4. As a maintainer, I want the slicer improver loop controlled by a DISTINCT `--slicer-loop-*` flag family (slice-path only, unmistakable from the gate's `--review-*`): `--slicer-loop` / `--no-slicer-loop` (on by default), `--slicer-loop-max <n>` (convergence cap; today's `maxReview`), and `--slicer-loop-model <id>` (the loop reviewer's de-correlated model — the seam already exists internally as the loop's `reviewModel`; rename it to `slicerLoopModel` and expose it), so I can skip/tune the improver without touching the gate flags.
5. As a maintainer, I want a fresh-context ACCEPTANCE review gate (`--review` / `--no-review`, on by default) that runs BEFORE the slices integrate \u2014 the slice-path mirror of the build Gate-2 \u2014 with a slice-SET prompt (coherence / dependency graph / gaps+overlap / \"if built, achieves the SPEC goal / correct-if-implemented\"), so a bad set never lands unreviewed.
6. As a maintainer, I want the slice acceptance gate to keep the BUILD `--review-*` family (`--review`/`--no-review`/`--review-model`) so there is one gate configuration story — and to be ONE-SHOT (terminal pass/fail), with NO rounds. (`--review-max-rounds` is an ORPHAN on the build gate — a rounds bound for a revise↔review loop whose revise step does not exist; the slice gate must NOT inherit it. Any future revise↔review LOOP gets its own loop-family flag, mirroring `--slicer-loop-max`. See `work/observations/reviewmaxrounds-on-wrong-concept.md`.)
7. As a maintainer, I want a `spec-sliced/` folder so `ls work/spec/` shows \"what PRDs still need slicing\" at a glance, exactly as `ls work/backlog/` shows \"what slices need building.\"
8. As a maintainer, I want the `spec-sliced/` FOLDER to be the source of truth for sliced-ness (like `done/` for slices), with the release transition moving the SPEC `slicing/ \u2192 spec-sliced/` in the same runner-owned commit that emits the slices, so there is one owner and no drift.
9. As a maintainer, I want `sliceAfter` resolved against `spec-sliced/` residence (mirroring `blockedBy` \u2192 `done/`) rather than the `sliced:` marker, so the two ordering mechanisms work the same way.
10. As a maintainer, I want re-slicing a sliced SPEC to be `spec-sliced/ \u2192 spec/` (reopen-to-ready, mirroring `done/ \u2192 backlog/`), so a reshaped SPEC re-enters the slice pool with no special case.
11. As a maintainer, I want existing `sliced:` PRDs BACKFILLED into `spec-sliced/` by the migration, so the new folder is the complete, canonical view from day one.
12. As a maintainer, I want the `sliced:` marker kept as a DERIVED COPY during the transition (written by the release owner), then REMOVED ENTIRELY in a final sequenced slice once nothing reads it \u2014 a clean isolated breaking change \u2014 so the migration is non-breaking, then the cruft is gone.

## Implementation Decisions

> Trimmed at slice-time into the slices / an ADR.

### Slice output through `performIntegration` (the KEYSTONE)

`do prd:` stops committing slices direct to `main`. The slicing work runs in a branch (in-place by default, like `do slice:`; the isolation seam upgrades to worktree/remote as needed); the produced `work/backlog/*` slices + the SPEC `slicing/ \u2192 spec-sliced/` release-move + the derived `sliced:` copy integrate through `performIntegration` (`--propose` \u2192 PR / `--merge` \u2192 main). The slicing LOCK is unchanged (ledger-write CAS on `main`, the visibility ref). Because the integrate args resolve in the shared core, every `do slice:` arg automatically applies to `do prd:` (US #2). This is likely the FIRST slice and the others depend on it.

### The two review concepts (mirror the build path) — TWO non-overlapping flag families

- IMPROVER loop (`slicer-review-loop.ts`, edits between passes, slice-only): keep; give it the `--slicer-loop-*` family — `--slicer-loop`/`--no-slicer-loop` (on by default), `--slicer-loop-max <n>` (rename today's `--max-review`/`maxReview`), `--slicer-loop-model <id>` (rename the loop's internal `reviewModel` field to `slicerLoopModel` and expose it). FIX the prompt to invoke the `review` skill's set-of-slices lens (graph / gaps / overlap / goal-composition), not just per-slice.
- ACCEPTANCE gate: a fresh-context review-before-integrate riding `performIntegration` (so it only exists once the output goes through the core), controlled by the BUILD `--review`/`--no-review`/`--review-model` family (on by default) with a slice-SET prompt — ONE-SHOT (terminal), NO rounds. `--review-max-rounds` is an orphan on the build gate (see `work/observations/reviewmaxrounds-on-wrong-concept.md`); the slice gate does NOT inherit it. A future revise↔review loop would get its own loop-family flag (mirroring `--slicer-loop-max`), not a gate knob.
- NAMING RULE: gate = `--review*` (shared with build); improver loop = `--slicer-loop*` (slice-only). No flag name spans both.

### The `spec-sliced/` folder + two-step marker migration

- STEP A: add `spec-sliced/`; release moves `slicing/ \u2192 spec-sliced/`; KEEP `sliced:` as a derived copy; flip the TWO `slicedSlugs` builders (`slicing.ts:readSlicedSlugs`, `ledger-read.ts:resolvePrdPool`) to read folder-residence (downstream `slicing-eligibility`/`select-priority` unchanged \u2014 they only see the `Set`); BACKFILL existing `sliced:` PRDs into `spec-sliced/`. Update `ledger-read`'s SPEC-existence/pool reads + WORK-CONTRACT/skill path references.
- STEP B (sequenced LAST, precedent: `allowAgents\u2192autoBuild`, `rename-reviewpr-to-review`): delete `setSlicedMarker` writes, drop `sliced` from the frontmatter type, remove the back-compat. Clean isolated breaking change.
- NAME: `spec-sliced/` (NOT bare `sliced/` \u2014 too close to the `slicing/` LOCK).

## Testing Decisions

> Trimmed into slices' acceptance criteria.

- Slice output integrates: `do prd:<slug> --propose` opens a PR with the slices and does NOT touch `main`; `--merge` lands them on `main`; reuse the build-path integration test harness (throwaway git repo).
- Arg parity: a table asserting `do slice:` integrate-time args resolve identically on the `do prd:` path (they share the core).
- Set-level improver review: the loop invokes the set lens (assert it reviews the graph/gaps/overlap, not just per-slice) \u2014 doc-shaped where it touches the skill.
- Acceptance gate: fresh-context gate runs before integrate; `--no-review` skips it; mirrors the build Gate-2 tests.
- Folder lifecycle: release moves `slicing/ \u2192 spec-sliced/` atomically with slice emission; `sliceAfter` resolves against `spec-sliced/` residence; re-slice `spec-sliced/ \u2192 spec/` re-enters the pool; backfill moves all `sliced:` PRDs.
- Marker removal (Step B): nothing reads `sliced:`; the field is gone; existing ordering still resolves via the folder.

## Out of Scope

- **Moving the slicing LOCK off `main` / onto a branch ref \u2014 REJECTED.** The lock is the visibility ledger (same as the build claim); keep it on `main` (the ledger-transition seam may move the LEDGER later, but that is the `claim-ledger-vs-protected-main` ADR's concern, not this SPEC's).
- **The `<build>/<design>/<notes>` umbrella reorg \u2014 NOT HERE.** Only the SPEC-state folder family (`spec/`\u2192`slicing/`\u2192`spec-sliced/`) is in scope; the umbrella stays an incubating idea.
- **The `allowAgents\u2192autoBuild` rename \u2014 NOT HERE** (it is advance-loop US #36, sequenced last there). Same MIGRATION SHAPE is reused for the `sliced:` removal, but the two renames are independent.
- **A standalone `slice <spec>` verb \u2014 REJECTED** (as in advance-loop; `do prd:` slices).

## Further Notes

- **Keystone ordering:** the `performIntegration` slice should land FIRST \u2014 the arg-parity, the acceptance gate, and (cleanly) the folder release-move all sit on it. The improver-prompt fix is independent. The marker removal (Step B) is LAST.
- **Mirror, don't invent:** every axis copies the build path (integrate core, flag taxonomy, Gate-2 shape, folder-as-source-of-truth). The win is consistency, which is exactly what advance-loop's \"one tick over every rung\" needs underneath it.
- **Feeds advance-loop:** once this lands, advance-loop's slice rung is just \"call the shared `do prd:` machinery\" with the integrate back-half it already assumes.
