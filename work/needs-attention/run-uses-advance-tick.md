---
title: unify run onto the advance tick - make the laptop daemon's per-item unit the advance lifecycle tick (not the build-only do tick), behaviour-preserving under calm gate defaults
slug: run-uses-advance-tick
blockedBy: [advance-autopick-lifecycle-pools, observation-triage-tri-state-gate, surface-blockers-gate, atomic-done-move-one-slug-one-folder, requeue-from-in-progress]
covers: []
---

> Self-contained ENGINE slice (`covers: []`, no `prd:`). Source: `work/ideas/run-uses-advance-tick.md` + ADR `docs/adr/ci-config-policy-and-gate-family.md` §1 (the laptop mirror of "CI always runs advance"). `blockedBy` the two gate slices because the calm defaults (`observationTriage: off`, `surfaceBlockers: off`) are what make this unification BEHAVIOUR-PRESERVING; without them, plain `run` would suddenly start surfacing questions.

## What to build

Make the laptop daemon `run`'s per-item unit the ADVANCE lifecycle tick (`performAdvance`) instead of the build-only `do` tick (`runOneItem`), so plain `run` ≡ today's `run --advance`, with the lifecycle rungs (triage / surface / apply) gated by the now-calm-default gates (`observationTriage: off`, `surfaceBlockers: off`). A user who has not opted into questions sees NO behaviour change (calm defaults ⇒ build/slice only, exactly today's plain `run`); a user who flips a gate gets the lifecycle for free, with no separate `--advance` mode to discover.

This is the swap the advance-loop architecture was BUILT for: `advance-loop-driver.ts` ALREADY wraps the advance tick in `run`'s exact parallel scheduler (`runConcurrent`, `maxParallel`/`perRepoMax`) over the SAME mirror-pool scan, and its doc comment states "run == CI: the loop is just repeated batches of THIS tick" + "swap the tick without re-architecting the loop". So this builds NO new scheduling machinery; it routes the daemon's tick through the advance path.

WHY this slice (the test-leverage point): `run` is locally unit-testable, whereas a CI workflow is not. Unifying `run` onto the advance tick means the SAME gates a CI workflow will use are exercised by `run`'s tests, so `runner-in-ci` can later lean on already-proven engine behaviour rather than re-proving it through generated YAML.

## Acceptance criteria

- [ ] Plain `run` (the daemon, no `--advance`) runs the ADVANCE tick as its per-item unit. With BOTH lifecycle gates at their defaults (`observationTriage: off`, `surfaceBlockers: off`), `run`'s observable behaviour is UNCHANGED from today's build-only `run` (build ready slices / slice ready PRDs / route failures to needs-attention; touch no observations, surface no questions). A test asserts this behaviour-equivalence on a fixture that today's plain `run` drains identically.
- [ ] With `observationTriage: ask|auto` and/or `surfaceBlockers: on`, plain `run` now ALSO performs the corresponding lifecycle rungs (triage / surface / apply) under its parallel scheduler, proven by a `run` test (the cheap stand-in for a CI workflow).
- [ ] The parallel `advancing`-borrow path under `runConcurrent` is correct: a CAS loser among in-flight ticks backs off having spent only the free classification (no double-advance), asserted by a concurrency test. Reuse the loop driver's existing borrow semantics; do NOT invent a new lock.
- [ ] DECISION (record while building): does `run --advance` become a deprecated NO-OP alias (plain `run` already IS advance), or is a `--build-only` escape retained? Default position: plain `run` becomes advance; `--advance` is a deprecated alias (kept, warns); NO `--build-only` unless a real divergence between "build-only" and "advance-with-gates-off" is found (record it if so).
- [ ] No regression in the existing `run` build/integrate/needs-attention path (the build-only behaviour is the gates-off advance behaviour, so the existing `run` tests must still pass or be migrated with their intent intact).
- [ ] Tests in the repo's vitest style; shared/global locations isolated to temp fixtures.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `advance-autopick-lifecycle-pools`: the foundation that puts observations + `needsAnswers` items into the auto-pick selection, without it, `run` unifying onto the advance tick would still never reach the lifecycle rungs (nothing to advance beyond build/slice), so the gates-on-lifecycle test would be vacuous.
- `observation-triage-tri-state-gate` AND `surface-blockers-gate`: the calm defaults (`off`/`off`) are what make this unification behaviour-preserving; build on both so the gates-off-equivalence and gates-on-lifecycle tests reference the real gates.
- `atomic-done-move-one-slug-one-folder` AND `requeue-from-in-progress` (SOUNDNESS, ledger-integrity): this slice makes plain `run` drive the FULL lifecycle autonomously through `performIntegration` (verified: `run.ts` imports it). That AMPLIFIES the transition/recovery bugs the `ledger-integrity` cluster fixes (ghost slug in two folders, items stranded in `in-progress/`), more autonomous transitions = more strand chances. Harden the transition (atomic done-move) + the recovery verb (requeue-from-in-progress) BEFORE scaling autonomy onto them. (The other ledger-integrity slices are recommended-first too, but these two are the load-bearing pair `run` hits directly.)

## Prompt

> Make the laptop daemon `run`'s per-item unit the ADVANCE lifecycle tick (`performAdvance`) instead of the build-only `do` tick (`runOneItem`), so plain `run` ≡ today's `run --advance` with calm-default gates, behaviour-preserving today, lifecycle-capable when a gate is flipped. Source: `work/ideas/run-uses-advance-tick.md`; ADR `docs/adr/ci-config-policy-and-gate-family.md` §1. This is the laptop mirror of "CI always runs advance", and the test-leverage move (`run` is unit-testable; a CI workflow is not).
>
> FIRST, drift-check: confirm `observation-triage-tri-state-gate` + `surface-blockers-gate` landed (the calm defaults exist). Confirm `advance-loop-driver.ts` still wraps `performAdvance` in `run`'s scheduler (`runConcurrent`, `maxParallel`/`perRepoMax`) over `scanMirrorPool`, holding the `advancing` borrow inside `performAdvance`; confirm plain `run`'s tick is `runOneItem` (build-only) in `run.ts`. If landed differently, reconcile or route to `needs-attention/`.
>
> DOMAIN: `advance` is a strict superset of the `do` build/slice tick; with the two lifecycle gates off it degrades to build/slice only. The loop driver was explicitly designed to "swap the tick without re-architecting the loop", so this routes the daemon's per-item unit through the advance path, NOT new scheduling machinery. `needs-attention` is unchanged.
>
> BUILD: route plain `run`'s per-item unit through `performAdvance` (reusing the loop driver's select-pool + run-batch-concurrently parts), so the gates govern the lifecycle rungs. RECORD the `--advance`-alias / `--build-only` decision (default: plain `run` becomes advance, `--advance` deprecated alias, no `--build-only` unless a real divergence surfaces).
>
> TEST (TDD, vitest, house style): gates-off behaviour-equivalence with today's plain `run`; gates-on lifecycle (triage/surface/apply under the scheduler); the parallel `advancing`-borrow no-double-advance; no regression in build/integrate/needs-attention. Isolate shared/global locations to temp fixtures.
>
> "Done" = plain `run` runs the advance tick, is behaviour-identical under calm defaults, performs the lifecycle when a gate is flipped, the borrow is race-correct, and the gate is green.

## Needs attention

The slice rests on a FALSE premise that plain `run` and today's `run --advance` already share a substrate, so unifying is just "swap the tick, no new scheduling machinery." They do not:

- Plain `run` (`run.ts` `runOnce`, ~L281): with no injected report it discovers the REGISTRY SET of bare hub mirrors via `scan(config)`/`listMirrors` and builds each item in a per-job worktree (`jobWorktreeStrategy`), concurrent across repos. This is what `run-daemon-reframe` (now in work/done/) shipped.
- `run --advance <mirror>` (`cli.ts` `buildAdvanceRunTick`, ~L224-300): scans ONE named mirror's pool but orchestrates the build/slice rungs via `performDo` IN-PLACE in `process.cwd()` (its own comment, cli.ts:217-220: "...IN-PLACE in the cwd checkout (`run`'s cross-repo mirror→worktree build substrate is the separate `run-daemon-reframe` work this does NOT duplicate)"; `do.ts:73-76`: in-place = no hub mirror, no external worktree).

So they differ in discovery (registry set vs single `--advance <mirror>` arg), isolation (N job worktrees vs one in-place cwd), and parallelism. They are NOT behaviour-equivalent, so the gates-off-equivalence acceptance criterion ("behaviour UNCHANGED from today's build-only `run` on a fixture today's plain `run` drains identically") cannot be satisfied by routing plain `run` through the existing `advanceRunTick`/`advanceOnce`, which take a single `mirrorPath` + single `context.cwd` and build in-place. There is no registry-set / worktree-per-mirror advance loop driver in the codebase.

This forces an unresolved, load-bearing, hard-to-reverse DESIGN decision the slice does not make and the (missing) source idea `work/ideas/run-uses-advance-tick.md` cannot settle:
  (a) route plain `run` through the existing single-mirror, in-place-cwd advance tick ⇒ plain `run` silently loses registry-set discovery + job-worktree isolation (a major regression, the opposite of "behaviour-preserving"); OR
  (b) make the advance tick run over the registry SET with per-mirror job worktrees ⇒ genuinely NEW scheduling/substrate machinery the slice explicitly forbids ("builds NO new scheduling machinery; it routes the daemon's tick through the advance path").

Compounding evidence the premise has drifted: ADR `ci-config-policy-and-gate-family.md` §5 and PRD `runner-in-ci.md` (L118) currently state the gates bite on "advance auto-pick / advance -n / run --advance" and that "plain run/do have no triage/surface rungs, so they are no-ops there" — i.e. the docs treat plain `run` as build-only and `run --advance` as the lifecycle path, the INVERSE of this slice's "plain run becomes advance". And the slice's stated source file `work/ideas/run-uses-advance-tick.md` does not exist in the repo (only `work/prd/runner-in-ci.md` references the slug), so the intended target substrate is unspecified.

Suggested re-scope: decide the unified `run`'s substrate FIRST (human/design call). Most likely the real work is to build a REGISTRY-SET advance loop driver that, per mirror, cuts job worktrees exactly like `runOnce`/`runOneItem` (reusing `claimAgainstRepo` + `jobWorktreeStrategy`), and only THEN swap plain `run`'s per-item unit to that. Either rewrite this slice around that (new-machinery, NOT a drop-in tick swap), or first land a precursor slice "advance loop driver over the registry set with per-mirror job-worktree isolation" and make this slice depend on it. Also: reconcile/clarify the ADR §5 + PRD L118 wording (plain `run` build-only vs plain `run` = advance) and restore the missing `work/ideas/run-uses-advance-tick.md` source so the intended substrate is pinned. Separately, three stale future-tense `run-daemon-reframe` comments (run.ts:202, run.ts:279, cli.ts:219) should be refreshed now that that slice is done (captured in work/observations/stale-run-daemon-reframe-future-tense-comments.md).
