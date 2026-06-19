---
title: make `--isolated` the DEFAULT build mode for `do` in a checkout (build in a job worktree off the arbiter, treat the cwd checkout as an origin source only) — with an explicit opt-OUT flag for true in-place
slug: make-isolated-the-default-build-mode
type: idea
status: incubating
---

# Flip the default: build ISOLATED, not in-place

> Captured 2026-06-11. Directly motivated by the entanglement incident the same
> day (a concurrent autonomous `do` job swept an assistant's uncommitted `work/
> ideas/` files into its own requeue chore commit `8c92f63`, because BOTH were
> writing the same working tree — see
> `work/observations/drive-backlog-skill-assumes-in-place-do-not-remote.md`). NOT
> built. This proposes changing a DECIDED default (ADR
> `command-surface-and-journeys` §3), so it is a deliberate reconsideration, not a
> gap-fill.

## The current decided model (what this would change)

ADR `command-surface-and-journeys` §3 defines THREE forms, with **in-place as the
default** for a checkout:

| form | which repo | where it builds |
| --- | --- | --- |
| `do <slug>` | current | **in the checkout** (in-place; refuses on a dirty tree) — DEFAULT |
| `do --isolated <slug>` | current | a job worktree off THIS repo's arbiter |
| `do --remote <r> <slug>` | foreign | a job worktree (isolation implied) |

`--isolated` was DELIBERATELY introduced (slice `do-isolated-in-place`, 2026-06-08)
as a **purely additive opt-in** — "names the isolation intent, the affordance an
isolated supervised conductor needs without forcing a foreign URL." This idea
asks: should isolation be the DEFAULT, with in-place the opt-out instead?

## The proposal

Make **`do <slug>` build ISOLATED by default** — in a job worktree off the
current repo's arbiter (the same isolation `--isolated`/`--remote`/`run` use) —
and treat the cwd checkout as an **origin SOURCE only** (read the arbiter remote,
never write/commit in the working tree). Add an explicit opt-OUT for the rare
true-in-place case (name TBD — `--in-place` / `--here` / `--no-isolated`).

So the default flips:

- `do <slug>` → isolated worktree off the arbiter (NEW default).
- `do --in-place <slug>` → today's in-checkout behaviour (opt-out).
- `--remote <r>` → unchanged (foreign repo, isolation implied).

## Why (the case FOR)

- **Removes the cwd-entanglement class of bug ENTIRELY.** The 2026-06-11 incident
  (a concurrent job's commit swallowing the human/assistant's uncommitted files)
  is IMPOSSIBLE when the build never writes the cwd tree. No dirty-tree refusals,
  no claim-reverts/done-moves landing in the working tree, no "rebuild the dist
  between merges" dance, no collision with whatever the human has uncommitted.
- **Converges conductor + daemon + human worker on ONE substrate.** `run` and
  `do --remote` already isolate; making plain `do` isolate too means there is ONE
  isolation model, not "in-place is special." The `drive-backlog` skill's whole
  in-place-vs-remote split (that observation) largely DISSOLVES — the conductor
  just runs `do` and the cwd is never touched.
- **Matches the safer mental model.** "The agent builds in its own worktree and I
  review the result" is what most users already assume; in-place mutating the
  human's checkout mid-build is the surprising part.
- **The cwd stays useful — as an origin source.** You still run `do` FROM your
  checkout (it resolves the arbiter from the cwd's remote); you just don't build
  IN it. That is the exact "cwd = origin source, not a write target" corollary the
  drive-backlog observation now states.

## Why NOT / caveats (the case AGAINST — do not hand-wave these)

- **Per-repo `.agent-runner.json` for isolated/`--remote` builds** — this WAS a
  blocker (isolated builds silently fell back to global+default for
  `harness`/`verify`/`provider`, so a repo declaring `harness: pi` could get the
  null adapter), but a slice that READS per-repo config from the arbiter's `main`
  has since landed (`remote-do-reads-per-repo-config-from-arbiter-main`, Gate-2
  approved 2026-06-11). So this prerequisite is LIKELY already met or nearly so —
  CONFIRM it covers the isolated-off-own-arbiter form (not only foreign
  `--remote`) before flipping, since the default MUST honour the repo's declared
  config. (In-place reads it from the local file; isolated reads it from
  `main:.agent-runner.json` on the arbiter — verify the two agree.)
- **Local-only / untracked slices become invisible.** Isolated builds off
  `origin/main`, so a slice (or its deps) that exists only in the local checkout
  and isn't pushed can't be built — in-place can. The default flip would mean
  "your slice must be on the arbiter," which is a real ergonomic change for the
  edit-locally-then-build loop. The opt-out (`--in-place`) covers it, but the
  DEFAULT would no longer "just build what's in my tree."
- **Cost.** Materialise-mirror-then-reap per build is slower than reusing the
  checkout — matters for a tight local iterate loop.
- **Offline / no-arbiter repos.** A repo with no configured arbiter has nothing to
  isolate off; the default would have to fall back to in-place (or error). The
  default must degrade sanely when there's no arbiter.
- **It changes a recently, deliberately decided default.** The ADR chose in-place
  default + isolated opt-in only weeks ago. Flipping needs an ADR amendment with
  the why recorded, not a silent change.

## Suggested shape / sequencing

1. **Confirm isolated builds honour per-repo `.agent-runner.json` FIRST** —
   likely already done via `remote-do-reads-per-repo-config-from-arbiter-main`;
   verify it covers the isolated-off-own-arbiter form (not only foreign
   `--remote`). The default cannot flip while an isolated build could run a
   different harness/gate than the repo declares.
2. Add the **opt-out flag** (`--in-place`/`--here`) so true-in-place survives.
3. Define the **no-arbiter / offline fallback** (degrade to in-place, or a clear
   error telling the user to configure an arbiter or pass `--in-place`).
4. **Flip the default** + amend the ADR §3 table (record the why: cwd-entanglement
   elimination + substrate convergence).
5. **Simplify `drive-backlog`** — much of its in-place-vs-remote special-casing
   collapses once plain `do` is isolated (it just builds; cwd never mutated).

## See also

- `work/observations/drive-backlog-skill-assumes-in-place-do-not-remote.md` — the
  cwd-as-origin-source-only corollary + the live entanglement evidence motivating
  this; also its open question (should `--remote`/isolated be the conductor's only
  mode) is the conductor-scoped version of THIS repo-wide default flip.
- `work/observations/review-nits-remote-do-reads-per-repo-config-from-arbiter-main-2026-06-11.md`
  — the (likely-resolved) prerequisite: remote/isolated `do` reading per-repo
  config from the arbiter's `main`. Confirm it covers the isolated-off-own-arbiter
  form before flipping the default.
- ADR `command-surface-and-journeys` §3 — the three-form model + the current
  in-place-default decision this would amend.
- `work/observations/review-nits-do-isolated-in-place-2026-06-11.md` — the
  ratification nits from when `--isolated` was first built (opt-in additive).
