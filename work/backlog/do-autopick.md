---
title: do-autopick — `do` auto-pick, multi-arg, `-n x`, slices-first priority (per-repo toggle)
slug: do-autopick
prd: command-surface-phase-2
blockedBy: [do-in-place, do-remote, autoslice-gate]
covers: [10]
---

## What to build

The multi-item selection forms of `do` (ADR §3), on top of the single-item
pipeline from `do-in-place`:

- **`do` (no arg)** — auto-pick ONE eligible thing and do it.
- **`do <a> <b> …`** — do those named items, in sequence.
- **`do -n <x>`** — do x eligible things, in sequence.
- **Auto-slice priority within a selection:** eligible **slices first, then PRDs to
  slice** (drain ready work before creating more), with a **per-repo toggle** to
  flip the order. This is the same priority the `run` tick + the autoslice path
  consume, so factor it as a shared, pure selection helper (not duplicated in `run`
  and `do`).

All forms run the existing `do` pipeline (`do-in-place`) per selected item, in
sequence (`do` is sequential — parallelism is `run`'s job).

**Two candidate POOLS, not one — and the PRD pool is NEW machinery.** The
slices-first/PRDs-second priority selects across TWO pools:
- **Eligible slices** — reuse the existing `scan`/`selectCandidates`/`eligibility`
  path (slice-only; it already exists). This is the slices pool.
- **Sliceable PRDs** — this does **NOT** exist in the scan/candidate model today:
  `scan`/`selectCandidates` are slice-only (`report.repos[].items` are backlog
  slices; there is no PRD candidate, no PRD eligibility). So the PRD pool is built
  HERE from (a) a PRD reader/enumerator over `work/prd/` (the same PRD read path
  `slug-namespace-resolution` introduced — reuse it, do not add a second) and (b)
  the **slicing-eligibility predicate from `autoslice-gate`** (`needsAnswers !==
  true && humanOnly !== true && autoSlice`, + `sliceAfter` resolution). Do NOT
  reinvent PRD eligibility — consume `autoslice-gate`'s pure predicate.

**Scope boundary with the slicing path.** This slice SELECTS a sliceable PRD into
the pool and dispatches it to the `do prd:<slug>` path; the actual slicing
orchestration is `autoslice-command` (blocked on `do-in-place`). If `do prd:`
slicing is not yet wired when this lands, the PRD branch may resolve+select the PRD
and reach the `do prd:` entry point (the same "reaches the entry, not yet wired"
state `do-in-place` leaves) — do NOT implement slicing here. The slices pool is
fully functional regardless.

This slice adds the SELECTION-and-ordering layer (auto-pick / count / multi-arg /
two-pool slices-first priority), not a new slice-eligibility model.

## Acceptance criteria

- [ ] `do` (no arg) auto-picks one eligible item; `do <a> <b>` does both in order;
      `do -n <x>` does x eligible items in sequence.
- [ ] Selection draws from TWO pools — eligible slices (via the existing
      `selectCandidates`/eligibility path) and sliceable PRDs (a NEW pool built from
      the PRD reader + `autoslice-gate`'s slicing-eligibility predicate; the
      scan/candidate model is slice-only today) — prioritising slices first, then
      PRDs-to-slice, with a per-repo toggle that flips the order; the priority logic
      is a SHARED pure helper reused by `run`'s tick (not duplicated).
- [ ] PRD eligibility is `autoslice-gate`'s predicate (not reinvented); a selected
      PRD dispatches to the `do prd:` path (slicing itself is `autoslice-command`,
      not built here).
- [ ] Each selected item runs the existing `do` pipeline (from `do-in-place`); `do`
      stays sequential.
- [ ] Tests (seeded backlog of slices + sliceable PRDs, stubbed harness): auto-pick
      picks the right single item; `-n`/multi-arg select the right set in the right
      order; slices-first ordering + the per-repo toggle flip; the shared helper is
      the one `run` uses.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `do-in-place` — the per-item pipeline each selected item runs; the selection
  layer sits on top of it. Must exist first.
- `do-remote` — NOT a logical dependency but a **conflict serialiser**: `do-remote`,
  `do-autopick`, and `do-in-place` all edit the SAME `do` command definition in
  `cli.ts` (its argument grammar). Serialise this after `do-remote` so the two are
  never built in parallel against the same command block (per ADR §10 / the
  file-orthogonality rule). `do-autopick` extends the grammar last (variadic args +
  `-n`), building on whatever `do-remote` added (`--remote`).
- `autoslice-gate` — supplies the pure PRD slicing-eligibility predicate +
  `sliceAfter` resolution the PRDs-to-slice pool is filtered by (the scan/candidate
  model is slice-only; PRD eligibility comes from the gate, not reinvented here).

## Prompt

> Build the multi-item selection forms of `do` per `docs/adr/command-surface-and-
> journeys.md` §3: `do` (auto-pick one), `do <a> <b> …` (those, in sequence),
> `do -n <x>` (x eligible, in sequence), with **slices-first then PRDs-to-slice**
> priority and a per-repo toggle. Build on the single-item `do` pipeline from
> `do-in-place` (do NOT reimplement it). Factor the slices-first priority as a
> SHARED pure helper that `run`'s tick also uses — do not duplicate it.
>
> FIRST run the drift check: confirm `do-in-place` (in `done/`) exposes a per-item
> pipeline to loop; confirm `scan`/`selectCandidates`/eligibility still provide the
> eligible set. Route to needs-attention on a discrepancy.
>
> READ FIRST: ADR `command-surface-and-journeys` §3 (the `do` forms + slices-first/
> per-repo-toggle), `src/scan.ts` + `src/select.ts` + `src/eligibility.ts` (the
> existing eligible-SLICE set + candidate selection to reuse for the SLICES pool),
> `src/run.ts` (the tick that will share the slices-first helper), the
> `slug-namespace-resolution` done file (the PRD reader you reuse for the PRD pool),
> the `autoslice-gate` done file (the PRD slicing-eligibility predicate +
> `sliceAfter`), and the `do-in-place` done file/module.
>
> CRITICAL: `scan`/`selectCandidates`/`eligibility` are SLICE-ONLY — there is no PRD
> in the candidate model. So this is TWO pools: the slices pool (reuse the existing
> path) and a NEW PRDs-to-slice pool you build from the PRD reader
> (`slug-namespace-resolution`'s) + `autoslice-gate`'s predicate. Do NOT reinvent
> PRD eligibility, and do NOT implement slicing (a selected PRD dispatches to the
> `do prd:` path; slicing is `autoslice-command`).
>
> Implement the selection-and-ordering layer (auto-pick / count / multi-arg /
> two-pool slices-first priority + per-repo toggle) as a shared pure helper, running
> the existing `do` pipeline per selected item, sequentially.
>
> TDD with vitest, house style (seeded slices + sliceable PRDs, stubbed harness):
> auto-pick, `-n`, multi-arg, slices-first ordering + toggle flip, and that `run`
> shares the helper. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim do-autopick --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/do-autopick <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/do-autopick.md work/done/do-autopick.md
```
