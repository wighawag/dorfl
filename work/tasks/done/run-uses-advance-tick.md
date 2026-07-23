---
title: 'unify run onto the advance tick - point the laptop daemon''s per-item unit at the registry-set advance driver (not the build-only do tick), behaviour-preserving under calm gate defaults'
slug: run-uses-advance-tick
blockedBy: [advance-loop-driver-registry-set-job-worktrees, atomic-done-move-one-slug-one-folder, requeue-from-in-progress]
covers: []
---

> Self-contained ENGINE slice (`covers: []`, no `prd:`). Source: ADR `docs/adr/ci-config-policy-and-gate-family.md` §1 (the laptop mirror of "CI always runs advance"). RE-SCOPED 2026-06-13 after a build-time STOP found the original premise false: plain `run` (registry-set + job worktrees, via `run-daemon-reframe`) and the advance loop driver (single-mirror + in-place cwd) did NOT share a substrate, so this was never a drop-in tick swap. The precursor `advance-loop-driver-registry-set-job-worktrees` builds the matching substrate (registry-set advance with per-mirror job-worktree isolation); THIS slice now simply points plain `run`'s per-item unit at it. `blockedBy` updated accordingly.

## What to build

Make the laptop daemon `run`'s per-item unit the ADVANCE lifecycle tick instead of the build-only `do` tick (`runOneItem`), by routing plain `run` through the **registry-set advance driver** the precursor slice built (registry-set discovery + per-mirror job-worktree isolation - the SAME substrate plain `run` uses today). With the lifecycle gates at their calm defaults (`observationTriage: off`, `surfaceBlockers: off`), the advance tick degrades to build/slice only, so a user who has not opted into questions sees NO behaviour change; a user who flips a gate gets the lifecycle (triage / surface / apply) for free, with no separate `--advance` mode to discover.

Because the precursor made the advance substrate match plain `run`'s (registry set + job worktrees), this IS now the clean swap the advance-loop architecture intended ("swap the tick without re-architecting the loop"): plain `run`'s `runLoop` already drives a `RunTick` seam, so this points that seam at the registry-set advance tick instead of the build-only `runOneItem`-based tick.

WHY this slice (the test-leverage point): `run` is locally unit-testable, whereas a CI workflow is not. Unifying `run` onto the advance tick means the SAME gates a CI workflow will use are exercised by `run`'s tests, so `runner-in-ci` can later lean on already-proven engine behaviour rather than re-proving it through generated YAML.

## Acceptance criteria

- [ ] Plain `run` (the daemon, no `--advance`) runs the REGISTRY-SET ADVANCE tick (from the precursor) as its per-item unit. With BOTH lifecycle gates at their defaults (`observationTriage: off`, `surfaceBlockers: off`), `run`'s observable behaviour is UNCHANGED from today's build-only `run` (registry-set discovery + per-mirror job-worktree isolation + build ready slices / slice ready PRDs / route failures to needs-attention; touch no observations, surface no questions). A test asserts this behaviour-equivalence on a fixture today's plain `run` drains identically. (This equivalence rests on the precursor's matching substrate - it is no longer the impossible "single-mirror in-place == registry-set worktrees" claim that triggered the original STOP.)
- [ ] With `observationTriage: ask|auto` and/or `surfaceBlockers: on`, plain `run` now ALSO performs the corresponding lifecycle rungs (triage / surface / apply) under its parallel scheduler, proven by a `run` test (the cheap stand-in for a CI workflow).
- [ ] The parallel `advancing`-borrow path is correct: a CAS loser among in-flight ticks backs off having spent only the free classification (no double-advance), asserted by a concurrency test. Reuse the precursor's borrow semantics; do NOT invent a new lock.
- [ ] DECISION (record while building): does `run --advance` become a deprecated NO-OP alias (plain `run` already IS advance), or is a `--build-only` escape retained? Default position: plain `run` becomes advance; `--advance` is a deprecated alias (kept, warns); NO `--build-only` unless a real divergence between "build-only" and "advance-with-gates-off" is found (record it if so). NOTE the precursor may already have folded the single-mirror `run --advance` path into the registry-set driver; reconcile with whatever it landed.
- [ ] No regression in the existing `run` build/integrate/needs-attention path (the build-only behaviour is the gates-off advance behaviour over the SAME substrate, so the existing `run` tests must still pass or be migrated with their intent intact).
- [ ] The docs the original STOP flagged are reconciled: ADR `ci-config-policy-and-gate-family.md` §5 and SPEC `runner-in-ci.md` (~L118) currently say plain `run` is build-only and `run --advance` is the lifecycle path (the INVERSE of "plain run becomes advance"). Update them to match the landed behaviour (plain `run` = advance with calm-default gates).
- [ ] Tests in the repo's vitest style; shared/global locations isolated to temp fixtures.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `advance-loop-driver-registry-set-job-worktrees` (THE SUBSTRATE): it builds the registry-set advance driver with per-mirror job-worktree isolation that matches plain `run`'s substrate. Without it, pointing plain `run` at the advance tick regresses discovery + isolation (the original STOP). This slice is the thin swap once that substrate exists.
- `atomic-done-move-one-slug-one-folder` AND `requeue-from-in-progress` (SOUNDNESS, ledger-integrity; both `work/done/`): this slice makes plain `run` drive the FULL lifecycle autonomously through `performIntegration`. That AMPLIFIES the transition/recovery bugs the ledger-integrity cluster fixed (ghost slug in two folders, items stranded in `in-progress/`). They are landed, so the soundness order holds; kept in `blockedBy` to record the dependency.

## Prompt

> Point the laptop daemon `run`'s per-item unit at the REGISTRY-SET ADVANCE tick (built by the precursor `advance-loop-driver-registry-set-job-worktrees`) instead of the build-only `do` tick (`runOneItem`), so plain `run` ≡ advance with calm-default gates: behaviour-preserving today, lifecycle-capable when a gate is flipped. Source: ADR `docs/adr/ci-config-policy-and-gate-family.md` §1. RE-SCOPED after a build-time STOP found plain `run` (registry-set + job worktrees) and the old advance loop driver (single-mirror + in-place cwd) did not share a substrate; the precursor closed that gap, so this is now the clean tick swap.
>
> FIRST, drift-check: confirm the precursor landed (a registry-set advance driver with per-mirror job-worktree isolation, behaviour-equivalent to plain `run`'s build tick under calm gates). Confirm plain `run`'s `runLoop` still drives a `RunTick` seam (so the swap is pointing that seam at the advance tick, not re-architecting the loop). Confirm the calm defaults (`observationTriage: off`, `surfaceBlockers: false`) exist. If anything landed differently, reconcile or route to `needs-attention/`.
>
> DOMAIN: `advance` is a strict superset of the `do` build/slice tick; with the two lifecycle gates off it degrades to build/slice only. The precursor made the advance substrate MATCH plain `run`'s (registry set + per-mirror job worktrees), so this swap is behaviour-preserving by construction. `needs-attention` is unchanged and always-on.
>
> BUILD: point plain `run`'s per-item unit (the `RunTick` the loop drives) at the precursor's registry-set advance tick. RECORD the `--advance`-alias / `--build-only` decision (default: plain `run` becomes advance, `--advance` a deprecated alias, no `--build-only` unless a real divergence surfaces; reconcile with whatever the precursor did to the single-mirror `run --advance` path). Reconcile the ADR §5 + SPEC `runner-in-ci.md` L118 wording (plain `run` build-only -> plain `run` = advance).
>
> TEST (TDD, vitest, house style): gates-off behaviour-equivalence with today's plain `run` over the same registry fixture (same discovery + worktree isolation + integration); gates-on lifecycle (triage/surface/apply under the scheduler); the parallel `advancing`-borrow no-double-advance; no regression in build/integrate/needs-attention. Isolate shared/global locations to temp fixtures.
>
> "Done" = plain `run` runs the registry-set advance tick, is behaviour-identical under calm defaults, performs the lifecycle when a gate is flipped, the borrow is race-correct, the ADR/SPEC wording is reconciled, and the gate is green.
