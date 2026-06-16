---
title: install-ci must NOT emit the redundant build-slice-tick workflow — advance-lifecycle is a strict superset (same advance verb, same gate values, same hourly cron), so two workflows run duplicate racing ticks for zero added capability
slug: install-ci-emits-one-advance-workflow-not-redundant-build-slice-tick
blockedBy: []
covers: []
---

## What to build

`agent-runner install-ci` emits BOTH a `build-slice-tick` workflow and an `advance-lifecycle` workflow (each via its own self-registering capability emitter — `src/install-ci-capabilities/build-slice-tick.ts` + `src/build-slice-tick-template.ts`, and the advance-lifecycle pair). At RUNTIME these two are functionally IDENTICAL: both invoke `agent-runner advance`, both carry the SAME `AGENT_RUNNER_*` gate values (`AUTO_BUILD: true`, `AUTO_SLICE: true`, `OBSERVATION_TRIAGE: off`, `SURFACE_BLOCKERS: false`), and both fire on the SAME hourly cron (`0 * * * *`). They have SEPARATE `concurrency` groups, so on the hourly tick they BOTH run and race over the same backlog (the claim CAS prevents double-building, so it is safe but wasteful — redundant enumeration + matrix legs every hour). Verified live: `advance-lifecycle` was observed building slices, exactly because it runs the same build/slice rungs as `build-slice-tick`.

`advance-lifecycle` is a STRICT SUPERSET of `build-slice-tick`: anything build-slice-tick does, advance-lifecycle also does (same verb, gates, cron), PLUS two things build-slice-tick lacks — the `on: push` trigger for `work/questions/**` (apply a committed answer promptly) and the `reap-merged-branches` job (`gc --remote-branches`). There is NO behaviour unique to build-slice-tick. The split is a historical artifact: it assumed a "build/slice-only" verb distinct from the lifecycle verb, but CI ALWAYS calls the single superset verb `advance` (never `do`), and the lifecycle gates degrade `advance` to build/slice behaviour at their calm defaults — so "build-slice-tick" is just advance-lifecycle with the question-push trigger and branch-reap removed, i.e. a strictly weaker duplicate.

Make `install-ci` emit ONE advance workflow (advance-lifecycle, the superset) and STOP emitting build-slice-tick. The user has already deleted `build-slice-tick.yml` from THIS repo by hand; without this fix a future `install-ci` run re-emits it (the files carry the "EMITTED by install-ci; DO NOT hand-edit; re-run install-ci to upgrade" banner — so the duplicate WILL come back). The root fix is in the emitter set.

Decide and record (Decisions): is the cleanest shape (a) DROP the `build-slice-tick` capability emitter entirely (advance-lifecycle becomes the sole advance workflow), or (b) keep ONE advance emitter and fold the question-push trigger + branch-reap into it under one name? Option (a) is the smaller change and matches "advance is one superset verb → one advance workflow". Either way the emitted result is a SINGLE advance workflow with the question-push trigger and the branch-reap, and NO second hourly advance tick. Preserve the other capabilities (intake, close-job) untouched — they are genuinely distinct, not advance duplicates.

## Acceptance criteria

- [ ] `agent-runner install-ci` emits NO `build-slice-tick` workflow — a single advance workflow (the advance-lifecycle superset) is emitted instead, carrying the `on: push` `work/questions/**` trigger AND the `reap-merged-branches` (`gc --remote-branches`) job. A test asserts the emitted file set contains exactly one `advance`-verb workflow (no `build-slice-tick.yml`).
- [ ] The retained advance workflow is unchanged in behaviour from today's advance-lifecycle (same gates, same matrix/sequential propose/merge shape, same triggers). A test pins its key shape (verb `advance`, the gate env block, the question-push path filter, the reap job).
- [ ] The OTHER capabilities install-ci emits (intake, close-job) are UNAFFECTED — they are not advance duplicates. A test asserts they still emit.
- [ ] If the `build-slice-tick` capability id was selectable/registered anywhere (wizard list, capability registry, docs), it is removed or aliased so a user cannot re-select it to regenerate the duplicate. A test/grep confirms no live registration of a standalone build-slice-tick advance workflow remains.
- [ ] The Decisions choice (drop the emitter vs fold into one) is recorded (ADR if it meets the bar, else a `## Decisions` note in the done record/PR).
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None. (Independent of the `branch-carries-code-not-ledger-status` PRD and of the trailer fix — this is purely the CI workflow emitter. It touches `src/install-ci-capabilities/*` + `src/build-slice-tick-template.ts` + any capability registry/docs, NOT the runtime engine.)

## Prompt

> FIRST, drift-check: confirm install-ci still emits TWO advance workflows via self-registering capability emitters — `src/install-ci-capabilities/build-slice-tick.ts` (+ `src/build-slice-tick-template.ts`) and the advance-lifecycle pair — and that at runtime they are functionally identical (same `advance` verb, same `AGENT_RUNNER_AUTO_BUILD/AUTO_SLICE/OBSERVATION_TRIAGE/SURFACE_BLOCKERS` values, same hourly cron), with advance-lifecycle ADDITIONALLY carrying the `on: push` `work/questions/**` trigger + the `reap-merged-branches` job. Read `src/install-ci-core.ts` (the `CapabilityEmitter` registry) to see how emitters self-register. If a prior change already consolidated to one advance workflow, route to needs-attention noting that. Note: `build-slice-tick.yml` has ALREADY been deleted from this repo by hand by the user; this slice makes that permanent at the SOURCE so install-ci does not re-emit it.
>
> WHY: `advance` is a single SUPERSET verb and CI always calls it (never `do`), so "build/slice-only" has no distinct verb — build-slice-tick is just advance-lifecycle minus the question-push trigger and branch-reap, i.e. a strictly weaker DUPLICATE that races the same backlog on the same hourly cron for zero added capability. Two hourly advance ticks per repo is redundant work (the claim CAS keeps it safe, not efficient). See `work/observations/` for the duplicate-advance-workflow note if present.
>
> GOAL: make install-ci emit ONE advance workflow (the advance-lifecycle superset, KEEPING its question-push trigger + branch-reap) and STOP emitting build-slice-tick. Prefer the smaller change — drop the build-slice-tick capability emitter — unless folding into one named emitter is cleaner; either way the emitted set has exactly one advance-verb workflow and no second hourly advance tick. Do NOT touch the genuinely-distinct intake / close-job capabilities. Record the drop-vs-fold decision.
>
> SEAM TO TEST AT: the install-ci emitter output — assert the emitted workflow set contains exactly one `advance`-verb workflow (no `build-slice-tick.yml`), that it retains the question-push `work/questions/**` trigger + the `reap-merged-branches` job + the gate env block, and that intake/close-job still emit. Mirror the existing install-ci / template tests (`*-template.test.ts`, `install-ci.test.ts`). No network.
>
> DONE: install-ci emits a single advance workflow (no redundant build-slice-tick), the superset behaviour (question-push + reap) is preserved, intake/close-job are untouched, the decision is recorded, and `pnpm -r build && pnpm -r test && pnpm format:check` passes. Do NOT perform git transitions (no stage/commit/push, no folder moves) — the runner/human owns those. NOTE this slice's own acceptance does NOT require editing `.github/workflows/` in this repo (already deleted by hand); it changes the EMITTER so the deletion stays permanent.
