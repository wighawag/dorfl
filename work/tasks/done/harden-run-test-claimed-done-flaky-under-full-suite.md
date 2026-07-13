---
promotedFrom: observation:run-test-claimed-done-flaky-under-full-suite-2026-07-10
---

## RE-SCOPED 2026-07-13 — CI-timeout constraint + the ENOTEMPTY half is already fixed

This task was mis-scoped for CI in two ways, now corrected (see `Done when` + Prompt step 4):
1. **The "20 consecutive full-suite runs" acceptance is un-CI-able.** ~5min/suite × 20 = ~100min, which exceeds the `timeout-minutes: 120` per-leg cap once agent reasoning/edits are added, so the leg TIMES OUT every attempt (confirmed live: run 29235819078's leg hit exactly 2h0m and was reaped, losing all WIP — a hard SIGKILL pushes nothing to a branch). Re-scoped to **3 consecutive `build && test` runs** (bounded, in-cap).
2. **The broader half (the ENOTEMPTY teardown race) is ALREADY FIXED** on main by the git-auto-gc-off change in `gitEnv` (commit `4fb7d87d`, 2026-07-13) — disable `gc.auto`/`maintenance.auto` in test fixtures so no background repack races the teardown. So this task's remaining scope is: verify whether the `claimed-done` assertion still flakes at all on current main; if not, record the discharge (pointing at `4fb7d87d`) rather than inventing a fix.

## Related findings (folded in 2026-07-12 — the flake is BROADER than one assertion)

Live lifecycle run `29206312575` gave concrete reproductions showing this is not confined to the `run.test.ts` `claimed-done` line. Under the `max-parallel: 4` fan-out (4 full `pnpm -r test` suites at once), the SAME class of full-suite-parallel flakiness red-bounced FIVE otherwise-fine advance-propose legs, on DIFFERENT test files each time, all via a fixture-teardown race:

```
Error: ENOTEMPTY: directory not empty, rmdir '.../fixture-.../.git'
```

Root of that variant: `Scratch.cleanup()` -> `rmSync(root, {recursive:true, force:true})` at `packages/dorfl/test/helpers/gitRepo.ts:152`. `force:true` suppresses `ENOENT` but NOT `ENOTEMPTY`, so a `git` subprocess still holding a `.git`/`.git/objects` dir during the recursive delete makes `rmdir` throw. Observed flaking: `prd-to-spec.test.ts`, `pre-backlog-staging-and-promote.test.ts`, `advancing-lock.test.ts`. A SEPARATE flake in the same run hit `cross-job-concurrent-land.test.ts` + `merge-retries-external.test.ts` with `expected 2 to be 1` count assertions (a CAS/mergeRetries timing race, distinct symptom).

Full triage in the two observations:
- `work/notes/observations/full-suite-flaky-enotempty-rmdir-on-git-fixture-teardown-fails-advance-legs-2026-07-12.md` (the teardown race + the CAS-count flake + the per-job table).
- `work/notes/observations/advance-propose-build-leg-has-no-timeout-minutes-so-a-wedged-agent-strands-the-run-for-6h-2026-07-12.md` (a related-but-distinct throttling/no-timeout gap on the same run).

Implication for THIS task's scope: the `run.test.ts` `claimed-done` assertion is likely ONE face of a general "git-fixture / spawned-subprocess teardown + timing races under full-suite parallelism" problem. When reproducing (Step 1 below), reproduce the ENOTEMPTY teardown race too (tight `pnpm -r test` loop on Linux), and prefer a fix that addresses the shared root (reap git subprocesses before `Scratch.cleanup()`, and/or a bounded ENOTEMPTY-aware retry on the remove) over a one-assertion patch. Keep the least-invasive principle; a shared-root fix in the test helper is still local (touches `packages/dorfl/test/helpers/`, not orchestration). Widen "Done when" to require the ENOTEMPTY teardown race to also be gone across the 20-run loop, not just the `claimed-done` line.

## What to build

Eliminate the intermittent failure of `packages/dorfl/test/run.test.ts` line ~633 (`expect(result.items[0].status).toBe('claimed-done')`) that appears roughly 1-in-2 runs when the WHOLE suite runs (`pnpm -r test` / `pnpm test`) but passes 39/39 in isolation. The test spawns real throwaway git repos + agents, so the working hypothesis is resource contention / a timing race under full-suite concurrency, NOT a logic bug in `run` orchestration itself.

Scope:
- Reproduce the flake under full-suite parallelism first (don't fix blind). Record the repro recipe (how many runs, concurrency settings, observed failure rate) in the task's own findings/PR body.
- Diagnose whether the race is: (a) vitest parallelism starving the spawned agent/git subprocesses, (b) a genuine wait/poll timing bug in the test's expectation of `claimed-done`, or (c) filesystem/tmpdir contention across parallel tests.
- Fix by the LEAST-INVASIVE means that restores trust in the acceptance gate. Prefer, in order:
  1. Tighten the test's synchronisation (await the actual state transition rather than a fixed timeout / racy poll) — this is the ideal fix because it also protects against real regressions.
  2. If (1) is not sufficient, serialise / isolate just this file (e.g. mark it non-concurrent, run it in its own vitest pool/shard, or give it a dedicated tmpdir) — a bounded, local carve-out, not a global concurrency reduction.
- Do NOT globally reduce test concurrency to paper over the race; the goal is a targeted hardening.
- Non-goals: refactoring `run` orchestration; changing unrelated tests; changing the acceptance gate itself.

Done when:
- The specific assertion passes reliably under `pnpm -r build && pnpm -r test` across **3 consecutive full-suite runs** (record the count in the PR/findings). NOTE (re-scoped 2026-07-13): the original "20 consecutive runs" is UN-CI-ABLE — 20× a ~5min suite is ~100min, over the `timeout-minutes: 120` per-leg cap once agent overhead is added, so it times out every time and loses all WIP (a hard SIGKILL saves nothing to a branch). 3 runs is a bounded, in-cap confidence check; if a human wants a deeper soak they can run more locally.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.
- A short note in the test (or a sibling findings file) explains WHY the hardening is there, so a future reader doesn't undo it.
- **If the flake NO LONGER REPRODUCES** on current main across the 3-run check (the ENOTEMPTY teardown race — the broader half of this task — is ALREADY fixed on main by the git-auto-gc-off root fix in `gitEnv`, commit `4fb7d87d`, and the `claimed-done` assertion may have been an adjacent face of the same contention): this task's remaining deliverable is to VERIFY + RECORD that (a findings note confirming the 3-run green + pointing at the gc-fix as the discharging artifact), NOT to invent a code change. Do not manufacture a fix for a flake that no longer bites.

## Prompt

> You are picking up a bounded test-hardening slice. `packages/dorfl/test/run.test.ts` around line 633 has an assertion `expect(result.items[0].status).toBe('claimed-done')` that is flaky (~1-in-2) under full-suite parallelism (`pnpm -r test` / `pnpm test`) but green 39/39 when `run.test.ts` runs in isolation. The test spawns real throwaway git repos + agents. Prior investigation (observation dated 2026-07-10) concluded this looks like resource contention / a timing race under full-suite concurrency, not a logic bug in `run` orchestration.
>
> Your job: make the acceptance gate trustworthy again for this assertion, with the LEAST-INVASIVE fix.
>
> Steps:
> 1. First reproduce the flake locally under full-suite parallelism and record the recipe + observed failure rate. Do not fix blind.
> 2. Diagnose the actual cause: racy wait/poll in the test, vitest parallelism starving spawned subprocesses, or tmpdir/filesystem contention.
> 3. Prefer fixing by tightening synchronisation in the test (await the real state transition rather than a fixed timeout or racy poll). If that alone is insufficient, fall back to a LOCAL carve-out (e.g. mark just this file non-concurrent, isolate its tmpdir, give it its own pool/shard). Do NOT globally lower test concurrency. Do NOT touch `run` orchestration logic.
> 4. Verify by running `pnpm -r build && pnpm -r test` **3 times consecutively** (NOT 20 — 20× exceeds the CI per-leg `timeout-minutes` cap and would lose all work to a hard SIGKILL) and confirming the assertion is stable; record the count. FIRST check whether the flake still reproduces AT ALL on current main: the ENOTEMPTY teardown race (the broader half of this task) is already fixed by the git-auto-gc-off change in `gitEnv` (commit `4fb7d87d`), and the `claimed-done` assertion may have been an adjacent face of the same full-suite contention. If 3 consecutive `build && test` runs are GREEN with no code change, the flake is already discharged — write a findings note recording that (pointing at `4fb7d87d`) and finish; do NOT invent a fix for a flake that no longer bites.
> 5. Leave a short in-code or sibling-findings note explaining WHY the hardening exists, so it isn't reverted later.
> 6. Final gate: `pnpm format` then confirm `pnpm -r build && pnpm -r test && pnpm format:check` is green.
>
> Out of scope: refactoring `run`, changing unrelated tests, altering the acceptance gate command itself.