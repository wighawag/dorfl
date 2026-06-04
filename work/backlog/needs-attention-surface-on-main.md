---
title: Surface needs-attention on main (cherry-pick the move) + resolve via start
slug: needs-attention-surface-on-main
prd: needs-attention-cherry-pick
blockedBy: [ledger-write-seam-needs-attention]
covers: [1, 2, 3, 4, 5, 6, 7]
---

## What to build

Make a stuck (needs-attention) slice **visible on `main`** so `scan`/`status`, a
fresh checkout, and other machines can tell "stuck" from "actively in-progress" —
and give the human a no-manual-moves way to pick one up. Mode-M only (unprotected
`main`). Built THROUGH the write seam's needs-attention transition
(`ledger-write-seam-needs-attention`), extending it — not bypassing it.

End-to-end behaviour (the full path):

1. **Routing (runner, on a stuck slice): always save + two commits.** On
   `work/<slug>`, produce (i) a **wip** commit holding the aborted agent work,
   then (ii) a **move-only** commit on top — purely the `git mv → needs-attention/`
   + the reason recorded in the body. The move-only commit is the tip; the wip
   never reaches `main`.
2. **Surface on `main`:** cherry-pick the **move-only** commit onto `main` so
   `main` shows `work/needs-attention/<slug>.md` with its reason. This is an
   operational/ledger write — it happens in BOTH `--merge` and `--propose` (the
   integration axis governs CODE only; `--propose` does not forbid writing `main`
   in mode M). A cherry-pick must NOT leave a half-surfaced state (surface fully
   or not at all).
3. **Resolve via `start` (and `work-on`) — no new command, no manual moves.**
   `start`'s folder dispatcher gains a `needs-attention/` row: print the recorded
   reason, transition `needs-attention → in-progress` THROUGH the write seam (which
   in mode M clears the `main` surface via the reverse move), then switch the human
   onto `work/<slug>`. **Unguarded** (no `--resume`): a stuck item is up-for-grabs.

The write seam's needs-attention transition is expressed as INTENT — "record
stuck + save work + make stuck-state observable" — and the mode-M strategy
implements it via the cherry-pick. Do NOT bake "cherry-pick to main" into the
seam's public contract (a future mode-P strategy must satisfy the same intent by
reading work-branch tips). This is the only "design for mode P" requirement.

## Acceptance criteria

- [ ] Routing a stuck slice yields TWO commits on `work/<slug>`: a wip (aborted
      work) and a move-only commit (the `git mv` + reason) as the tip.
- [ ] The move-only commit is cherry-picked to `main`; `main` then shows
      `work/needs-attention/<slug>.md` with its reason; the wip is NOT on `main`.
- [ ] Surfacing happens in BOTH `--merge` and `--propose` (it is not suppressed by
      propose — it is a ledger write, not code integration).
- [ ] `scan`/`status` (offline, reading `main`) distinguish stuck from in-progress;
      `status` reports the recorded reason.
- [ ] `start <slug>` (and `work-on <slug>`) on a needs-attention item: prints the
      reason, moves it `needs-attention → in-progress` via the write seam (clearing
      the `main` surface), switches to `work/<slug>` — with NO manual file move,
      unguarded (no `--resume`).
- [ ] The cherry-pick/transition never leaves a half-surfaced state.
- [ ] "Cherry-pick to main" is NOT part of the write seam's public contract (mode-M
      strategy owns it); claim/complete success paths are UNCHANGED.
- [ ] Tests against throwaway repos + a local `--bare` arbiter cover: routing →
      main surface + branch wip saved; propose AND merge both surface; resolve via
      start clears the main surface + lands on the branch; reason shown. Race tests
      stay in the non-parallel vitest project. `pnpm -r build && pnpm -r test &&
      pnpm -r format:check` green.

## Blocked by

- `ledger-write-seam-needs-attention` — this slice EXTENDS the write seam's
  needs-attention transition (adds the surface-on-main intent + the resolve path);
  it must exist first. (Transitively builds on the whole ledger-transition seam.)

## Prompt

> Add **needs-attention surfacing on `main`** (mode M) and a no-manual-moves human
> resolve path, built THROUGH the write seam's needs-attention transition. READ
> the done file for `ledger-write-seam-needs-attention` + the seam module FIRST —
> you are EXTENDING that transition, not bypassing it.
>
> READ FIRST: `docs/adr/claim-ledger-vs-protected-main.md` (the seam; the "future
> protected-main strategy" is analysis only — do NOT build it), `work/prd/needs-
> attention-cherry-pick.md` (this slice's PRD — the resolved design), `src/needs-
> attention.ts` (`routeToNeedsAttention`/`returnToBacklog`; reason is BODY prose),
> `src/start.ts` (the folder dispatcher: backlog→claim, in-progress→--resume,
> done/absent→refuse — add a `needs-attention/` row), `src/status.ts` +
> `src/scan.ts` (the surfaces that read `main`), and the runner stuck routing in
> `src/run.ts` + `complete.ts` abort paths.
>
> Implement: (1) routing saves the aborted work as a **wip** commit then a
> **move-only** commit (tip) on `work/<slug>`; (2) the mode-M strategy
> **cherry-picks the move-only commit to `main`** so the stuck state is visible
> (in BOTH merge and propose — surfacing is a ledger write, NOT code integration;
> `--propose` does not forbid writing main in mode M); (3) `start`/`work-on` on a
> needs-attention item prints the reason, transitions it back to in-progress via
> the write seam (clearing the main surface), and switches onto the branch —
> unguarded, no manual moves. Keep the seam contract as INTENT ("surface the stuck
> state"), NOT "cherry-pick to main" (so mode P could differ later). No
> `ledgerMode`/mode/config. Never `--force` to main.
>
> TDD with vitest (throwaway repos + local `--bare` arbiter; race tests in the
> NON-PARALLEL project). Cover: two-commit routing + main surface + wip-not-on-main;
> propose AND merge both surface; resolve-via-start clears the surface and lands on
> the branch and shows the reason; claim/complete unchanged. "Done" = acceptance
> criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim needs-attention-surface-on-main --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/needs-attention-surface-on-main <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/needs-attention-surface-on-main.md work/done/needs-attention-surface-on-main.md
```
