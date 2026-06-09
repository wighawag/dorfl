---
title: run-daemon-reframe — `run` = forever-looping parallel daemon; `--once` = debug tick; retire watch
slug: run-daemon-reframe
prd: command-surface-phase-2
blockedBy: [registry-remote]
covers: [12]
---

## What to build

Reframe `run` to the ADR §3 model: the **cross-repo, parallel, forever-looping daemon** — and absorb the deleted `watch` verb's behaviour so nothing is lost.

- **`run` (no flag)** — loop the supervised tick over the **registry** (the hub-mirror set from `registry-remote`): scan, claim up to `maxParallel` (`perRepoMax` per repo), run the agents in job worktrees, integrate, then **loop** (the future system service). Today `run` THROWS unless `--once`; this slice makes the no-flag form the looping daemon.
- **Genuine concurrency is REQUIRED, not optional — it is the whole point of `run`.** The reason `run` exists at all (vs `do`) is to run **multiple agents in parallel** on non-interacting slices across the registry. So this slice MUST make the tick genuinely concurrent. Know the current reality: TODAY `runOnce` is **sequential** — it `selectCandidates` up to `maxParallel`, then runs them in a `for (const candidate of candidates) { await runOneItem(...) }` loop, ONE AT A TIME. The job worktrees, the claim CAS, and per-item config resolution are all already designed for parallel jobs (each slug → distinct `work/<slug>` branch → distinct worktree; the arbiter CAS picks the winner), so concurrency is the missing execution wiring, not a model change.
  - Run up to **`maxParallel`** `runOneItem`s **in flight at once**, capped at **`perRepoMax`** concurrently per repo (the caps already exist in config; today they only bound SELECTION — now they must bound actual in-flight execution).
  - Mind the real concurrency hazards (they are why this is the load-bearing part): **claim-race safety** under parallel claims (the arbiter CAS already serialises — a loser gets exit-2 and is dropped; preserve that), **worktree isolation** (distinct slug → distinct worktree, so no collision — but do not share mutable state across the in-flight jobs), and **integration ordering** (two jobs rebasing onto a moving `<arbiter>/main` — each does rebase-or-abort→needs- attention independently per ADR §10; do not serialise integration into a bottleneck, but ensure a conflicting rebase routes that ONE job to needs-attention without affecting the others).
  - The forever-loop (the daemon) wraps the concurrent tick: each tick claims+runs a concurrent batch, integrates, then the loop continues. Do NOT ship a sequential loop and call it `run`; the help/docs and behaviour must both be genuinely concurrent.
- **`run --once`** — one tick then stop. A debug/test affordance on the daemon (NOT the CI path — CI is `do`). The existing `runOnce` IS this tick; keep it.

> **FORWARD-POINTER (advance-loop):** the genuinely-concurrent loop machinery this slice builds is the REUSABLE part. The `advance-loop` PRD (`work/prd/advance-loop.md`) makes the `run` daemon the LOOP driver that wraps a generalised `advance` TICK (build / slice / triage / surface / apply), "ideally" building on this slice. So build the concurrent loop so its TICK is swappable — today the tick is `runOneItem` (build a slice); advance-loop will swap it for the advance tick without re-architecting the loop. Keep the loop and the tick as separable units (the loop owns concurrency/scheduling; the tick owns one item's work). Stays slice-only here (as already scoped) — this note is about KEEPING THE LOOP/TICK SEPARABLE, not adding scope.

- **SCOPE: `run`'s tick stays SLICE-ONLY here; PRD-auto-slicing in `run` is a noted follow-up.** The ADR §3 intends `run`/`do` to do "slices-first, then PRDs to slice." But the two-pool (slices + sliceable-PRDs) priority helper is built by `do-autopick` (which depends on `autoslice-gate` + the PRD reader — deps THIS slice does not have). `run-daemon-reframe` likely lands BEFORE `do-autopick`, so do NOT build PRD-slicing selection here — `run`'s tick selects ELIGIBLE SLICES (today's `selectCandidates`), now run concurrently + looped. Wiring `run`'s tick to also auto-slice eligible PRDs (adopting `do-autopick`'s shared slices-first helper) is a small FOLLOW-UP integration once both this and `do-autopick` are in `done/`. Noted here so it is not lost; do not overclaim PRD-slicing in `run` now.
- **Absorb the retired `watch` verb** (its slice `work/backlog/watch.md` is being retired by this slice): `watch` was "loop `run --once` with bounded-session + surface-failures rails". Fold that into `run`:
  - the loop is `run`'s no-flag form (forever; a bounded session — max-iterations / max-duration — is the operator's stop discipline, kept as options if cheap);
  - **surface failures, don't infinite-retry**: a stuck item (timeout / red gate / conflict) routes through the EXISTING ledger needs-attention seam transition (`applyNeedsAttentionTransition`), surfaced on `main` (the cherry-pick that has landed) — `run` must RELY on that (it already falls out of `runOneItem`), not add bespoke failure reporting. This is exactly what `watch` required.
- **Retire `work/backlog/watch.md`** as part of this slice (the `git mv`/`rm` is the runner/human's at integrate-time; note it in the completion). Its behaviour is fully covered here.

## Acceptance criteria

- [ ] `run` (no flag) loops the tick over the registry (forever / until a stop bound); it no longer throws on the no-flag form.
- [ ] The tick runs agents **genuinely concurrently** — up to `maxParallel` `runOneItem`s in flight at once, capped at `perRepoMax` per repo (the caps now bound actual in-flight execution, not just selection). A test proves real concurrency (e.g. multiple jobs in flight simultaneously, not one-at-a-time), and that claim-race/worktree/integration safety holds under parallelism (a lost claim is dropped; a conflicting rebase routes only its own job to needs-attention).
- [ ] `run --once` runs exactly one tick then stops (the existing `runOnce`), documented as the debug/test affordance, NOT the CI path.
- [ ] A failing item is surfaced via the existing ledger needs-attention seam (surfaced on `main`) and is NOT infinite-retried within a session (assert it routes through the seam, not a bespoke reporter) — the retired `watch` slice's acceptance criterion, preserved.
- [ ] `run` reads the registry (hub-mirror set), not a `roots` walk.
- [ ] `work/backlog/watch.md` is retired (removed); its behaviour is covered by `run`.
- [ ] Tests (stubbed harness, local `--bare` arbiter): the loop honours its stop condition(s); one `--once` tick runs without throwing; a failing item routes through the seam; a tick spans multiple registered repos.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `registry-remote` — `run` now loops over the REGISTRY (hub-mirror set), not the removed `roots` walk; the registry must exist first (also serialises the cli.ts edit after the foundation).

## Prompt

> Reframe `run` to the daemon model per `docs/adr/command-surface-and-journeys.md` §3: `run` (no flag) = the cross-repo, parallel, forever-looping daemon over the REGISTRY; `run --once` = one debug tick (NOT the CI path). Absorb the deleted `watch` verb's bounded-loop + surface-failures behaviour into `run`, and RETIRE `work/backlog/watch.md` (its behaviour is fully covered here).
>
> FIRST run the drift check: confirm `registry-remote` (in `done/`) replaced the `roots` walk with the hub-mirror registry that `run` now loops over; confirm `run.ts`'s `runOnce` tick + its needs-attention routing via `applyNeedsAttentionTransition` (and the on-`main` surfacing) still exist. Read `work/backlog/watch.md` to confirm you are preserving its acceptance criteria before deleting it. Route to needs-attention on any discrepancy.
>
> READ FIRST: ADR `command-surface-and-journeys` §3 (run = daemon, `--once` = debug, CI = `do`) + §5/§6 (registry, freshness), `src/run.ts` (`runOnce` — the tick to loop; the existing needs-attention seam routing to RELY on, not replace), `src/cli.ts` (the `run` command that currently throws unless `--once`), and `work/backlog/watch.md` (the behaviour to fold in: bounded session, surface failures via the seam, multi-repo) + the `done/` files for `ledger-write-seam- needs-attention` + `needs-attention-surface-on-main` it referenced.
>
> Make `run` (no flag) loop the tick over the registry (forever / until a stop bound — keep max-iterations/max-duration if cheap); keep `run --once` as one tick. Stuck items surface via the EXISTING seam (do not add bespoke reporting). Retire `watch.md` (note the removal for the runner's integrate-time git).
>
> ON CONCURRENCY (REQUIRED — the whole point of `run`): `runOnce` is SEQUENTIAL today (`for (const candidate) { await runOneItem }`) even though it selects up to `maxParallel` candidates. This slice MUST make the tick genuinely concurrent: run up to `maxParallel` `runOneItem`s IN FLIGHT at once, `perRepoMax` per repo (the caps already exist — make them bound actual in-flight execution, not just selection). The substrate is already parallel-ready (distinct slug → distinct worktree; the arbiter CAS serialises claims, losers get exit-2). Mind the hazards: claim-race safety, worktree isolation (no shared mutable state across in-flight jobs), and integration ordering (each job rebases-or-aborts onto a moving `<arbiter>/main` independently per ADR §10 — a conflict routes only THAT job to needs-attention). Do NOT ship a sequential loop labelled "concurrent". Test that real concurrency happens (multiple jobs in flight) and that safety holds under it.
>
> TDD with vitest, house style (stubbed harness, local `--bare` arbiter): loop stop condition; `--once` one tick no-throw; failing item routes through the seam (not a bespoke reporter); a tick spans multiple registered repos. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim run-daemon-reframe --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/run-daemon-reframe <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/run-daemon-reframe.md work/done/run-daemon-reframe.md
```
