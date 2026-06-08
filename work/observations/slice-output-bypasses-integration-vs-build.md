---
title: slicing OUTPUT bypasses performIntegration (no propose/PR option) while build integrates through it — the real lock/visibility is consistent, the OUTPUT path is not
type: observation
status: spotted
spotted: 2026-06-08
---

# Slicing commits straight to `main`; build integrates via `performIntegration`

Spotted during the `do prd:advance-loop` test-drive (2026-06-08), in a design
conversation that first MIS-diagnosed the issue as "the slicing LOCK on `main` is
the inconsistency" and then corrected it. This note records the **corrected**
model so the muddle is not re-introduced when advance-loop is sliced (the
advance-loop PRD's "one substrate-agnostic tick, isolation falls out of the seam"
premise depends on getting this right).

## What is ACTUALLY consistent (do not "fix" this)

The slicing **lock** and the build **claim** are the SAME primitive — the
ledger-write CAS — differing only in folder + ref name:

- build claim (`claim-cas.ts`): `git mv backlog/<slug> → in-progress/<slug>` as a
  force-with-lease micro-commit **to `main`** on ref `claim/<slug>`.
- slicing lock (`slicing-lock.ts`): `git mv prd/<slug> → slicing/<slug>` as a
  force-with-lease micro-commit **to `main`** on ref `slicing/<slug>`.

Both move-on-`main` ON PURPOSE: `main` is the **claim ledger** — the visibility ref
where `in-progress`/`slicing` become readable by everyone (offline `scan`). See
`docs/adr/claim-ledger-vs-protected-main.md`: `main` plays two conflated roles
(claim ledger = agent-writable visibility; integration target = where code lands,
possibly protected), and a **ledger-transition seam** already exists so a future
strategy could move the LEDGER off `main` to a dedicated ledger BRANCH while
KEEPING status = a file in a folder read over a ref (maintainer's recorded lean:
P-opt-2, preserve in-progress-as-a-file). So "the lock is on `main`" is correct and
consistent across build and slice — an aborted slice leaves an orphaned
`slicing/<slug>` exactly like an aborted claim leaves an orphaned
`in-progress/<slug>`; same recovery story (human / gc / requeue).

> A dangling `work/slicing/advance-loop.md` lock was in fact left on `origin/main`
> by the aborted test-drive run — harmless, recoverable by the normal
> lock-release move; it is NOT evidence of a slicing-on-main bug.

## The REAL inconsistency (narrowed)

It is not the lock — it is the **OUTPUT**. Build integrates its code OUTPUT through
`performIntegration` (`src/integration-core.ts`), honoring `--propose` (push the
work branch + open a PR) / `--merge` (land on `main`). **Slicing does NOT**: its
doc-comment is explicit — *"This path does NOT call `performIntegration` … the
slicing transition is a DIFFERENT runner-owned move."* The produced
`work/backlog/*` slices commit STRAIGHT TO `main` via `releaseSlicingLock`'s
`emitSlices`/`markSliced`. There is **no propose mode, no PR option** for slice
output.

Why it matters (the proof case): **CI wanting slices in a PR.** advance-loop
User Story #27 says `propose` mode → a MATRIX of independent jobs, each opening a
PR. A PRD-slice rung in that matrix **cannot open a PR today** — slicing can only
merge-to-`main`. So `do prd:` is supposed to be "just another `do` rung," but it
cannot honor `--propose`. That breaks the advance-loop "one tick, output integrates
through the shared back-half" premise: slicing is the rung that falls OUT of the
integrate seam the wrong way.

## The coherent split (the conclusion we reached)

Two orthogonal axes, both made consistent across build AND slice:

- **Lock / visibility** → ledger ref (`main` today, maybe a dedicated ledger
  branch later via the seam), as a move-into-a-status-folder. Already consistent
  (build claim ≡ slicing lock). KEEP.
- **Output integration** → through `performIntegration` (`--propose` → PR /
  `--merge` → main), for BOTH build and slice. Build does this; **slice must be
  brought onto it** so slice output CAN be a PR. The agent's slicing WORK can run
  in-place-on-a-branch like `do slice:<slug>` already does (branch ≠ worktree; the
  isolation seam decides worktree/remote) and the produced slices integrate via the
  shared back-half — instead of `releaseSlicingLock` committing them direct to
  `main`.

## Folder-as-source-of-truth for sliced PRDs (paired decision, same coherence pull)

Spun out of the same conversation (see the related folder-taxonomy idea). For
SLICES the FOLDER is already the source of truth (`done/` = done; there is no
`done:` marker). To make PRDs consistent ("same model for prd, minus done"): a
`prd-sliced/` (name TBD) folder becomes the source of truth, mirroring `backlog/` ↔
`done/`, with `slicing/` as the `in-progress/` analogue:

| build | PRD analogue | meaning |
|---|---|---|
| `backlog/` | `prd/` | ready to slice (the "what needs slicing" human glance) |
| `in-progress/` | `slicing/` | locked, being sliced (exists today) |
| `done/` | `prd-sliced/` (name TBD) | sliced, resting |

- The maintainer's lean: **drop `sliced:` as source of truth, keep it only as a
  derived COPY** written at the release transition (exactly as build has NO marker
  and the folder is canonical). One owner (slicing-release) writes folder + copy in
  ONE commit → no drift (the same atomicity advance-loop US #11 already demands).
- Re-slice = `prd-sliced/ → prd/` (reopen-to-ready), legitimate, mirroring the
  existing `done/ → backlog/` reopen — this DISSOLVES the folder-taxonomy idea's
  "non-terminal flow" objection ("minus done" answers it rather than dodging it).
- CONSEQUENCE to flag: `autoslice-gate` today resolves `sliceAfter` against the
  `sliced:` MARKER. If the folder becomes source of truth, `sliceAfter` must read
  the FOLDER (stat `prd-sliced/<dep>.md`) — same mechanism as `blockedBy` → `done/`
  (`blockedBy`→`done/`, `sliceAfter`→`prd-sliced/`, identical). More consistent,
  but a real code change. (The folder-taxonomy idea PREVIOUSLY rejected
  folder-encoded sliced-ness partly because sliced-ness was marker-derived; that
  rejection is reversed here — the folder becomes canonical and the marker the
  derived copy.)

## Open forks (resolve BEFORE slicing advance-loop)

1. **Output integration:** confirm slice output should route through
   `performIntegration` (bringing `--propose`/`--merge` to slicing) — this likely
   wants its OWN slice and may need to LAND BEFORE advance-loop's slices (advance's
   tick assumes one integrate back-half for every rung). Or: is it in-scope to
   advance-loop's slicing, or a precursor?
2. **Folder split for PRDs:** adopt `prd/` ↔ `prd-sliced/` (name TBD) with
   folder-as-source-of-truth + `sliced:` as derived copy? This rewrites part of the
   folder-taxonomy idea AND touches `autoslice-gate`'s `sliceAfter` resolution.
3. **Lock-axis encoding under advance-loop:** advance-loop US #19 specs
   `work/advancing/` as a FOLDER borrow (move-on-`main`). That is CONSISTENT with
   the corrected model above (lock = move-into-a-status-folder on the ledger ref) —
   so the earlier "move advancing to a branch ref" musing was WRONG and should NOT
   be carried into the PRD. Keep `advancing/` as a folder borrow.

## Disposition

Spotted + partly decided. The lock/visibility consistency is CONFIRMED (no action).
The output-integration gap and the folder-split are CONCLUSIONS the maintainer is
converging on but has not finalised — they should be reconciled into the
folder-taxonomy idea and (if they change the lock/output model) fed back into
`work/prd/advance-loop.md` BEFORE it is sliced, or the slicer will re-encode the
slicing-bypasses-integrate path. Do NOT slice advance-loop until forks 1–2 are
resolved.
