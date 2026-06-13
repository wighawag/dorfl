---
title: unify run onto the advance tick - make the laptop daemon run the advance lifecycle tick (not the build-only do tick), since advance is a strict superset and the loop driver already reuses run's scheduler
slug: run-uses-advance-tick
type: idea
status: incubating
---

# run uses the advance tick (collapse run's do-vs-advance the same way CI did)

> Captured 2026-06-12 from the `runner-in-ci` design conversation. The laptop mirror of the CI decision "always advance, never do" (`docs/adr/ci-config-policy-and-gate-family.md` §1). NOT built; its own slice/PRD. Depends on / pairs with the two new gates (`observation-triage-tri-state-gate.md`, `surface-blockers-gate.md`).

## The realization

CI collapsed the `do`-vs-`advance` choice: `advance` is a strict superset of `do` (build slice / slice PRD + the lifecycle rungs), and with the lifecycle gates at their calm defaults it degrades to exactly `do`'s build/slice behaviour. So CI always runs `advance`.

The SAME split exists on the laptop daemon: plain `run` runs the build-only tick (`runOneItem`: build + integrate + needs-attention), while `run --advance` runs the advance lifecycle tick. But `advance-loop-driver.ts` ALREADY wraps the advance tick in `run`'s exact parallel scheduler (`runConcurrent`, `maxParallel`/`perRepoMax`) over the SAME mirror-pool scan; its own doc comment says "run == CI: the loop is just repeated batches of THIS tick" and the advance-loop design explicitly anticipated "swap the tick without re-architecting the loop". So unifying `run` onto the advance tick is the swap the architecture was built for, not new machinery.

## The change (sketch, to be designed at PRD/slice time)

Make the laptop daemon `run` use the advance lifecycle tick as its per-item unit, so plain `run` ≡ today's `run --advance`, with the two new lifecycle gates (`observationTriage`, `surfaceBlockers`) defaulting CALM. A user who has not opted into questions sees NO behaviour change (calm defaults ⇒ build/slice only, same as today's plain `run`); a user who flips a gate gets the lifecycle for free, with no separate `--advance` mode to discover.

## Open questions for PRD/slice time

- Does plain `run` BECOME the advance tick (and `--advance` becomes a deprecated no-op alias), or does `run` default to advance while keeping a `--build-only` escape? With calm defaults the former should be behaviour-preserving, but confirm against the build-only path's exact semantics (e.g. does build-only ever differ from advance-with-gates-off beyond the absent rungs?).
- Sequencing: land AFTER (or alongside) `observationTriage` + `surfaceBlockers`, so the calm defaults exist to make the unification behaviour-preserving.
- Confirm the parallel `advancing`-borrow path under the daemon's `runConcurrent` matches the build tick's claim semantics (the loop driver already holds the borrow inside `performAdvance`; verify no scheduler-level divergence).
- This is a laptop concern; it does NOT change the CI shape (CI already always-advances). But it makes `run` and CI genuinely the SAME tick, closing the last `do`-vs-`advance` duplication.
