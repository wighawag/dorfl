---
title: Route do prd:<slug> slice output through performIntegration (the keystone — honor --propose/--merge, arg parity by construction)
slug: slice-output-through-integration
prd: slicing-coherence
blockedBy: []
covers: [1, 2]
---

## What to build

Make the `do prd:<slug>` slicing path emit its produced `work/backlog/*` slices
**through the shared integrate back-half** (`performIntegration`), instead of
committing them straight to the arbiter `main` via the slicing lock's
`emitSlices`/`markSliced`. This is the KEYSTONE the acceptance gate, the
folder-lifecycle release-move, and arg-parity all sit on.

End-to-end behaviour after this slice:

- `do prd:<slug> --propose` PUSHES a work branch and opens a PR carrying the
  produced slices (and the PRD lifecycle transition), and does NOT land them on
  `main`.
- `do prd:<slug> --merge` lands them on `main`.
- Because the integrate-time args resolve ONCE in the shared core, EVERY
  `do slice:<slug>` integrate-time arg automatically applies to `do prd:<slug>`
  (arg parity BY CONSTRUCTION — not a duplicated parser).

The slicing **lock stays exactly as-is** (the ledger-write CAS `prd → slicing/`
on `main` — the visibility ref; see `docs/adr/claim-ledger-vs-protected-main.md`
and `work/observations/slice-output-bypasses-integration-vs-build.md`). Only the
OUTPUT path changes: the agent's slicing work runs on a branch (in-place by
default, like `do slice:` — branch ≠ worktree; the isolation seam decides), and
the produced slices integrate through the shared core.

The done-move inside `performIntegration` is currently slice-shaped
(`git mv work/in-progress/<slug>.md → work/done/<slug>.md`). The slicing path's
"item move" is the PRD lifecycle move, NOT a slice done-move — so this slice must
introduce the seam by which the slicing transition supplies its OWN move + its
OWN emitted files to the shared integrate band (the verify→review→commit→rebase
→integrate machinery) without pretending the PRD is a built slice. Keep the
agent's no-git boundary (the agent writes slice files only; the runner owns every
git transition).

> Note on the lifecycle move's FINAL shape: the `slicing/ → prd/` (today) vs
> `slicing/ → prd-sliced/` (later) destination is decided by the
> `prd-sliced-folder-step-a` slice, which is sequenced AFTER this one. THIS slice
> keeps the current `slicing/ → prd/` restore destination and `sliced:` marker —
> it changes only WHERE the OUTPUT integrates (direct-main → `performIntegration`),
> not the folder destination. The folder slice then swaps the destination on top
> of this seam.

## Acceptance criteria

- [ ] `do prd:<slug> --propose` opens a PR with the produced slices and does NOT
      touch arbiter `main` (assert via a throwaway-git-repo integration test;
      reuse the build-path integration harness — see `complete-integration.test.ts`
      / `run-integration-core.test.ts` patterns).
- [ ] `do prd:<slug> --merge` lands the slices on `main`.
- [ ] The slicing LOCK behaviour is unchanged (a held lock still serialises;
      acquire/release CAS on `main` intact; the content-identity stale check still
      fires on a concurrent edit).
- [ ] Arg parity: a test asserts the `do slice:` integrate-time args resolve
      IDENTICALLY on the `do prd:` path (they share `performIntegration`), not via
      a duplicated parser — e.g. a parity table over the integrate-time flags.
- [ ] The agent still does NO git (it writes `work/backlog/*.md` only); the runner
      owns every git-state transition.
- [ ] Both the in-place (`do prd:`) and `--remote` (`do --remote prd:`) dispatch
      paths route output through the shared core.
- [ ] Tests cover the new behaviour and mirror the repo's existing integration-test
      style (throwaway git repos; `GIT_CONFIG_GLOBAL` isolation as the suite does).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. (This is the FIRST slice of this PRD; the others
  depend on it.)

## Prompt

> Make `do prd:<slug>` route its produced `work/backlog/*` slices through the
> SHARED integrate back-half `performIntegration` (`src/integration-core.ts`),
> instead of committing them straight to `main` via the slicing lock's
> `emitSlices`/`markSliced` path. Goal: `do prd: --propose` opens a PR with the
> slices (no `main` touch); `--merge` lands them; and because integrate-time args
> resolve once in the shared core, every `do slice:` integrate arg applies to
> `do prd:` by construction (US #1, #2).
>
> DOMAIN VOCABULARY: the slicing LOCK (`src/slicing-lock.ts`,
> `acquireSlicingLock`/`releaseSlicingLock`) is the ledger-write CAS
> `prd → slicing/` on `main` (the visibility ref) — it is CORRECT and stays
> unchanged (`docs/adr/claim-ledger-vs-protected-main.md`; the lock is NOT the
> inconsistency). The OUTPUT is. `performIntegration` is the shared
> verify→review→done-move→commit→rebase→integrate band extracted in the
> `extract-integration-core` slice (in `done/`) and shared by `do`/`complete`/`run`.
> `performSlice` (`src/slicing.ts`) is the `do prd:` orchestration (gate → lock →
> to-slices harness → runner-owned commit); its step 4 currently calls
> `releaseSlicingLock` with `emitSlices`/`markSliced` and its doc-comment says it
> "does NOT call performIntegration" — that is what you are changing.
>
> WHERE TO LOOK (by concept, verify paths — they may have drifted):
> `src/slicing.ts` (`performSlice` step 4, the completing transition),
> `src/integration-core.ts` (`performIntegration`; the done-move
> `git mv work/<source>/<slug>.md → work/done/<slug>.md` is slice-shaped — the
> slicing transition needs to supply its OWN lifecycle move + emitted backlog
> files to the band rather than a slice done-move), `src/do.ts` (the
> `resolved.namespace === 'prd'` dispatch, BOTH the in-place and `--remote`
> branches), `src/cli.ts` (the `do` command flag wiring). The slicing lock's
> `releaseSlicingLock` already takes `emitSlices`/`markSliced`/
> `routeToNeedsAttention` and owns the `slicing/ → prd/` (or → needs-attention)
> move — decide cleanly which transition (the lock release vs the integrate band)
> owns WHICH part of the final commit, keeping it ONE runner-owned commit (no
> partial state) and keeping the agent git-free.
>
> SEAM TO TEST AT: the throwaway-git-repo integration tests (reuse the build-path
> harness — `test/complete-integration.test.ts`, `test/run-integration-core.test.ts`,
> `test/slicing.test.ts`, `test/slicing-lock.test.ts`). Assert: `--propose` →
> PR + `main` untouched; `--merge` → on `main`; lock unchanged; arg parity.
>
> SCOPE FENCE: do NOT move the slicing lock off `main` (REJECTED in the PRD). Do
> NOT change the folder destination of the lifecycle move (that is the
> `prd-sliced-folder-step-a` slice) — keep the current `slicing/ → prd/` restore +
> `sliced:` marker; only change WHERE the output integrates. Do NOT add the
> acceptance gate here (that is `slice-acceptance-gate`, blocked on this).
>
> FIRST run the drift check (this slice is a launch snapshot): confirm
> `performSlice` step 4 still uses `releaseSlicingLock`'s `emitSlices`/`markSliced`
> and still does NOT call `performIntegration`; confirm `performIntegration`'s
> done-move is still `work/<source>/ → work/done/`. If the slicing path ALREADY
> routes output through `performIntegration`, or the seam landed differently,
> route this slice to `needs-attention/` with the discrepancy
> (WORK-CONTRACT.md "Drift is a needs-attention signal") rather than building on a
> stale premise.
>
> "Done" = `do prd: --propose`/`--merge` behave as above with tests, the lock is
> unchanged, arg parity is asserted, the agent does no git, and
> `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.
