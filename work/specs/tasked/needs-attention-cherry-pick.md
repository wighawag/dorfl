---
title: 'needs-attention surfacing on main via cherry-pick (built against the ledger-transition seam)'
slug: needs-attention-cherry-pick
sliceAfter: [ledger-transition-seam]
---

> **Sliced into `work/backlog/` on 2026-06-04** — detail trimmed to the slice + the ADR. Launch snapshot, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/backlog/needs-attention-surface- on-main.md` (one slice). The resolved design lives in Solution below; the ADR `docs/adr/claim-ledger-vs-protected-main.md` holds the durable seam rationale.

## Problem Statement

When a claimed slice gets stuck, the runner `git mv`s it `in-progress → needs-attention` **on the `work/<slug>` branch only**. On `main` the slice still sits in `work/in-progress/` (where the claim landed), so anything reading `main` — `scan`, a fresh checkout, another machine — sees a normal in-progress item and **cannot tell "stuck" from "actively being worked."** The stuck state is invisible at the operational surface.

On an unprotected-`main` repo (the common case dorfl serves today) there is a clean fix: **surface the stuck state on `main` by cherry-picking the needs-attention move commit to `main`.** Then `main` reflects reality (`work/needs-attention/<slug>.md`), `scan`/`status` see it with no new mechanism, and it travels cross-machine for free. This is the "easy add" noted in `work/ideas/needs-attention-surfacing.md`.

This SPEC delivers that surfacing, built **against the ledger-transition write seam** (the `ledger-transition-seam` SPEC must be sliced first) so it is expressed as a transition strategy concern, not bolted onto the move code.

## Solution

Make the needs-attention transition **also surface on `main`** so the operational surface (`scan`, `status`, a fresh checkout, another machine) sees a stuck slice as `work/needs-attention/<slug>.md` on `main`, with its recorded reason. Design decisions (resolved in the design session — do not relitigate):

- **Always save the aborted work (fixed invariant, never-lose-work).** Routing a stuck slice produces **TWO commits** on `work/<slug>`: (i) a **wip** commit holding the aborted agent work, then (ii) a **move-only** commit on top — purely the `git mv → needs-attention/` + the reason in the body. The move-only commit is the tip. ("Non-atomic" is moot: the runner owns and completes the whole transition; no partial state escapes to a human.)
- **Surface on `main` by cherry-picking the MOVE-ONLY commit to `main`** (not the wip — the aborted work never reaches `main`). Visible + cross-machine for free.
- **The surfacing axis is NOT the integration axis.** `--merge`/`--propose` govern CODE integration only; `--propose` simply tells the runner to open a PR for the code instead of merging it — it does NOT forbid writing `main`. The needs-attention cherry-pick is an OPERATIONAL/ledger write, not code, so it happens in BOTH `--merge` and `--propose` (mode M). The thing that would forbid it is branch _protection_ (a future mode P), never `--propose`.
- **The write seam carries INTENT, not mechanism.** The needs-attention transition means "record stuck + save work + make stuck-state OBSERVABLE." The mode-M strategy implements that by cherry-picking the move to `main`; a future mode-P (protected-main) strategy would satisfy the SAME intent by reading work-branch tips. "Cherry-pick to main" MUST NOT be baked into the seam's public contract — that is the (cost-free) design-for-mode-P requirement.
- **The human resolves via `start` (and `work-on`) — NO new command, NO manual file moves.** `start`'s folder-dispatcher gains a `needs-attention/` row: it prints the recorded reason, transitions the item `needs-attention → in-progress` THROUGH the write seam (mode M clears the `main` surface via the reverse move), then switches the human onto `work/<slug>`. It is **unguarded** (no `--resume`): a stuck item is explicitly up-for-grabs.

## User Stories

1. As a maintainer, I want a stuck (needs-attention) slice to show up as `work/needs-attention/<slug>.md` **on `main`**, so that `scan`/`status` and any fresh checkout can tell stuck from in-progress without inspecting work branches.
2. As a maintainer, I want the stuck state to travel **cross-machine** (because it is on `main`), so a slice that got stuck on one machine is visible from another.
3. As a maintainer, I want the aborted/partial work still SAVED with the move on the `work/<slug>` branch (never-lose-work), so surfacing on `main` does not discard the failed attempt.
4. As a maintainer, I want surfacing implemented **through the ledger-transition write seam's needs-attention path**, so it is a transition-strategy concern and a future strategy could surface differently without rewriting this.
5. As a maintainer, I want resolving a needs-attention item (back to `backlog/`, or completing it) to update `main` so the stuck entry does not linger, so the `main` surface stays truthful.
6. As a maintainer, I want `status` to keep reporting the reason a slice is stuck, so the surfaced item is actionable, not just visible.
7. As a maintainer, I want this to change behaviour ONLY for the needs-attention path (claim/complete unchanged), so the surfacing is a contained addition.

### Autonomy notes (the two gate axes)

- **`humanOnly`:** OMITTED. Mechanical, well-specified git behaviour (cherry-pick a move commit to `main`) on the unprotected-`main` path the system already serves. No product/security judgement. Agent-buildable.
- **`needsAnswers`:** OMITTED at launch. The mechanism (cherry-pick the move commit to `main` via the write seam; save the work on the branch; clean up on resolve) is decided. The one dependency is structural, handled by `sliceAfter: [ledger-transition-seam]` (this SPEC is sliced only after the seam, so its slices can `blockedBy` the real seam slugs).

> Implementation & testing detail moved to the slice (what to build) and the ADR `docs/adr/claim-ledger-vs-protected-main.md` (the durable _why_). The resolved design is summarised in Solution above.

## Out of Scope

- **Protected-`main` surfacing** (reading stuck-state from work-branch tips over the network). That belongs to a future protected-`main` strategy — analysis only in `docs/adr/claim-ledger-vs-protected-main.md`; not built here.
- **Introducing the seam itself** — that is the `ledger-transition-seam` SPEC (prerequisite; this SPEC's `sliceAfter` points at it).
- **Any `ledgerMode`/mode/config** — none introduced.

## Further Notes

- Source idea: `work/ideas/needs-attention-surfacing.md` (the "easy add" / `main` cherry-pick path). Source ADR: `docs/adr/claim-ledger-vs-protected-main.md`.
- `sliceAfter: [ledger-transition-seam]` is intentional: this SPEC's slices should reference the seam's real slugs in `blockedBy`, so it must be sliced after the seam. This ordering also serves as a live test of the `sliceAfter` mechanism (per the maintainer: "we will test that this way").
