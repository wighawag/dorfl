---
title: Surface needs-attention beyond the work branch (must not write main → read work branches)
slug: needs-attention-surfacing
type: idea
status: incubating
---

# Surfacing needs-attention (pre-SPEC / incubating idea)

> Captures the chosen DIRECTION for making a stuck (`needs-attention`) slice visible beyond its own work branch — and why the "surface it on `main`" alternatives are ruled out by a hard architectural constraint.

## The problem

When a claimed slice gets stuck, the runner `git mv`s it `in-progress → needs-attention` **on the `work/<slug>` branch only**. On `main` the slice still sits in `work/in-progress/` (the claim landed there), so anything reading `main` (`scan`, a fresh checkout) sees a normal in-progress item and **cannot tell stuck from actively-being-worked**. We want it surfaced — ideally cross-machine.

## The decisive constraint: needs-attention must NOT write `main`

needs-attention is an **error-path event** that happens regardless of integration mode. Integration has two modes:

- **`merge`** — the runner may push to `main`.
- **`propose` (the DEFAULT)** — the runner pushes the **work branch only** and a human merges via review. This is also the mode used when **`main` is branch-protected** (the remote rejects direct pushes to `main`).

Therefore any design that surfaces stuck-state **by writing the move onto `main`** (cherry-picking the move commit to main, or merging a move-only commit to main) is **fundamentally incompatible with `propose` mode / protected `main`** — in those repos the runner is not permitted to (and the server will reject) a push to `main`. Since `propose` is the default and protected-main is the safety-conscious norm, **surfacing-via-main is dead.** (This rules out the earlier cherry-pick and move-only-to-main ideas.)

## The chosen direction: read from the work branches, never write main

Keep `main` a **pure claim ledger** (it only ever shows `in-progress` at claim and `done` at completion — never the needs-attention intermediate). Make the **operational surface read the stuck-state from where it actually lives**: the `work/<slug>` branch / job worktree.

- **`scan`** stays a fast, OFFLINE claim-ledger view (no "stuck"); it must not gain a network dependency.
- **`status`** becomes the stuck-authority, from two sources:
  1. **Local** — retained job worktrees + harness liveness (catches crashed/aborted-before-push, no network). Already partly present.
  2. **Cross-machine** — inspect the arbiter's `work/*` branch tips: a `work/<slug>` branch whose tip has the slice in `work/needs-attention/` ⇒ stuck. (`git ls-remote` + read the file location at each tip.)

This works **identically in `merge` and `propose`**, protected `main` or not, because it only ever **pushes the work branch** (which both modes do, and which is also how the work is SAVED — see below) and **reads** branch tips. It never writes `main`.

## commit ≠ push: saving the aborted work

The agent never commits; its aborted work is uncommitted in the worktree. In this system work is only **saved** when **pushed to the arbiter** (ADR §4) — a local commit is not saved. So to both SAVE the failed attempt and make it travel cross-machine, needs-attention routing should: commit the aborted work (a `wip` commit) + the move, and **push the work branch**. The pushed branch is then both the saved work AND the cross-machine stuck signal `status` reads. (If we decide the failed attempt is disposable, skip committing it — but then it is neither saved nor visible cross-machine; leaning SAVE, per never-lose-work.)

## Requirements this implies

- needs-attention routing **pushes the `work/<slug>` branch** (save + visibility); it must NOT push `main`.
- **resolve deletes** the work branch (so the surface doesn't accrue stale branches): returning to backlog / completing removes the arbiter work branch.
- `status` gains arbiter `work/*` inspection (cross-machine); `scan` stays offline.
- Distinguishing "actively working" vs "stuck" on a `work/<slug>` branch comes from the file location at the tip (in-progress vs needs-attention), plus local harness liveness for the crashed-before-routing case.

## Why not just main

Because of the constraint above: the default + protected-main case forbids the runner writing `main` on the error path. Reading work branches is the only mode-agnostic, protection-compatible mechanism. (This supersedes the cherry-pick / move-only-to-main alternatives, which were elegant but only legal in `merge` mode.)

## Built against the ledger-transition seam (accepted ADR)

The accepted ADR `docs/adr/claim-ledger-vs-protected-main.md` (status: accepted) introduces a **ledger-transition seam** (a read seam + a write seam) with the current behaviour as the only strategy — **no mode, no config.** This surfacing idea is the natural **follow-on built against that write seam**: surface needs-attention **on `main`** via the cherry-pick mechanism described above (the "easy add"). It is a separate slice from introducing the seam (the seam is a pure behaviour-identical refactor; this adds behaviour on top of it).

The seam keeps `scan` OFFLINE (reads `main`) — so the "`scan` stays OFFLINE" framing above is correct as-is for today's system. (A _future_ protected-`main` strategy behind the seam, if ever built, would read needs-attention from the work-branch tips over the network instead of `main` — but that strategy does not exist and is not part of this idea; see the ADR's "future protected-`main` strategy" analysis section.)
