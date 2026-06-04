---
title: needs-attention surfacing on main via cherry-pick (built against the ledger-transition seam)
slug: needs-attention-cherry-pick
sliceAfter: [ledger-transition-seam]
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth:
> `docs/adr/` (decisions) + the code; remaining work: `work/backlog/` slices.
> (The technical-detail sections below are trimmed by `to-slices` once the work
> is sliced — they move into slices/ADRs and this PRD settles to its durable
> framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

When a claimed slice gets stuck, the runner `git mv`s it
`in-progress → needs-attention` **on the `work/<slug>` branch only**. On `main`
the slice still sits in `work/in-progress/` (where the claim landed), so anything
reading `main` — `scan`, a fresh checkout, another machine — sees a normal
in-progress item and **cannot tell "stuck" from "actively being worked."** The
stuck state is invisible at the operational surface.

On an unprotected-`main` repo (the common case agent-runner serves today) there is
a clean fix: **surface the stuck state on `main` by cherry-picking the
needs-attention move commit to `main`.** Then `main` reflects reality
(`work/needs-attention/<slug>.md`), `scan`/`status` see it with no new mechanism,
and it travels cross-machine for free. This is the "easy add" noted in
`work/ideas/needs-attention-surfacing.md`.

This PRD delivers that surfacing, built **against the ledger-transition write
seam** (the `ledger-transition-seam` PRD must be sliced first) so it is expressed
as a transition strategy concern, not bolted onto the move code.

## Solution

Make the needs-attention transition **also surface on `main`** by cherry-picking
the move commit to `main`, via the ledger-transition write seam's
needs-attention path. After this, the operational surface (`scan`, `status`,
a fresh checkout, another machine) sees a stuck slice as
`work/needs-attention/<slug>.md` on `main`, with its recorded reason.

- The needs-attention move is committed on the `work/<slug>` branch as today (so
  the aborted/partial work is SAVED with the move — never-lose-work), AND its move
  commit is cherry-picked onto `main` so `main` shows the stuck state.
- Cherry-picking to `main` is legal here because this targets the **unprotected-
  `main` world the current single strategy already serves** (the same world where
  the claim CAS writes `main`). It is NOT a protected-`main` mechanism — a
  protected-`main` strategy is explicitly out of scope (and recorded only as
  analysis in the seam ADR).
- Resolving a needs-attention item back to `backlog/` (or completing it) updates
  `main` accordingly, so `main` never accretes a stale `needs-attention/` entry.

## User Stories

1. As a maintainer, I want a stuck (needs-attention) slice to show up as
   `work/needs-attention/<slug>.md` **on `main`**, so that `scan`/`status` and any
   fresh checkout can tell stuck from in-progress without inspecting work branches.
2. As a maintainer, I want the stuck state to travel **cross-machine** (because it
   is on `main`), so a slice that got stuck on one machine is visible from another.
3. As a maintainer, I want the aborted/partial work still SAVED with the move on
   the `work/<slug>` branch (never-lose-work), so surfacing on `main` does not
   discard the failed attempt.
4. As a maintainer, I want surfacing implemented **through the ledger-transition
   write seam's needs-attention path**, so it is a transition-strategy concern and
   a future strategy could surface differently without rewriting this.
5. As a maintainer, I want resolving a needs-attention item (back to `backlog/`,
   or completing it) to update `main` so the stuck entry does not linger, so the
   `main` surface stays truthful.
6. As a maintainer, I want `status` to keep reporting the reason a slice is stuck,
   so the surfaced item is actionable, not just visible.
7. As a maintainer, I want this to change behaviour ONLY for the needs-attention
   path (claim/complete unchanged), so the surfacing is a contained addition.

### Autonomy notes (the two gate axes)

- **`humanOnly`:** OMITTED. Mechanical, well-specified git behaviour (cherry-pick
  a move commit to `main`) on the unprotected-`main` path the system already
  serves. No product/security judgement. Agent-buildable.
- **`needsAnswers`:** OMITTED at launch. The mechanism (cherry-pick the move
  commit to `main` via the write seam; save the work on the branch; clean up on
  resolve) is decided. The one dependency is structural, handled by
  `sliceAfter: [ledger-transition-seam]` (this PRD is sliced only after the seam,
  so its slices can `blockedBy` the real seam slugs).

## Implementation Decisions

- **Build against the write seam, not the raw move.** The needs-attention
  transition behind the seam gains the cherry-pick-to-`main` surfacing; call sites
  (`complete.ts` failure paths, the runner's stuck routing in `run.ts`,
  `needs-attention.ts`) drive it through the seam.
- **Two effects, one logical transition:** (a) commit the move (+ saved aborted
  work) on `work/<slug>`; (b) cherry-pick that move commit onto `main`. Keep them
  consistent (a cherry-pick failure must not leave a half-surfaced state — surface
  or don't, never partially).
- **Unprotected-`main` only.** This is the current single strategy's world; do NOT
  add a protected-`main`/mode branch here. (Protected-`main` surfacing is analysis
  only in the seam ADR.)
- **Cleanup on resolve:** returning to `backlog/` or completing removes the
  `needs-attention/` entry from `main` (the resolve transition, through the seam,
  keeps `main` truthful).

## Testing Decisions

- Against throwaway git repos + a local `--bare` arbiter (the established
  pattern): drive a slice to needs-attention, assert `main` now shows
  `work/needs-attention/<slug>.md` AND the `work/<slug>` branch retains the saved
  aborted work + the move.
- Assert `scan`/`status` (offline, reading `main`) now distinguish a stuck slice
  from an in-progress one, with the reason reported by `status`.
- Assert resolve (back-to-backlog / complete) clears the `needs-attention/` entry
  from `main` (no stale surface).
- Assert claim/complete success paths are UNCHANGED (surfacing touches only the
  needs-attention path). Keep race tests in the non-parallel vitest project.

## Out of Scope

- **Protected-`main` surfacing** (reading stuck-state from work-branch tips over
  the network). That belongs to a future protected-`main` strategy — analysis
  only in `docs/adr/claim-ledger-vs-protected-main.md`; not built here.
- **Introducing the seam itself** — that is the `ledger-transition-seam` PRD
  (prerequisite; this PRD's `sliceAfter` points at it).
- **Any `ledgerMode`/mode/config** — none introduced.

## Further Notes

- Source idea: `work/ideas/needs-attention-surfacing.md` (the "easy add" / `main`
  cherry-pick path). Source ADR: `docs/adr/claim-ledger-vs-protected-main.md`.
- `sliceAfter: [ledger-transition-seam]` is intentional: this PRD's slices should
  reference the seam's real slugs in `blockedBy`, so it must be sliced after the
  seam. This ordering also serves as a live test of the `sliceAfter` mechanism
  (per the maintainer: "we will test that this way").
