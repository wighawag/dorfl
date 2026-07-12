---
promotedFrom: observation:run-test-claimed-done-flaky-under-full-suite-2026-07-10
---

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
- The specific assertion passes reliably under `pnpm -r test` across at least 20 consecutive full-suite runs locally (record the count in the PR/findings).
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.
- A short note in the test (or a sibling findings file) explains WHY the hardening is there, so a future reader doesn't undo it.

## Prompt

> You are picking up a bounded test-hardening slice. `packages/dorfl/test/run.test.ts` around line 633 has an assertion `expect(result.items[0].status).toBe('claimed-done')` that is flaky (~1-in-2) under full-suite parallelism (`pnpm -r test` / `pnpm test`) but green 39/39 when `run.test.ts` runs in isolation. The test spawns real throwaway git repos + agents. Prior investigation (observation dated 2026-07-10) concluded this looks like resource contention / a timing race under full-suite concurrency, not a logic bug in `run` orchestration.
>
> Your job: make the acceptance gate trustworthy again for this assertion, with the LEAST-INVASIVE fix.
>
> Steps:
> 1. First reproduce the flake locally under full-suite parallelism and record the recipe + observed failure rate. Do not fix blind.
> 2. Diagnose the actual cause: racy wait/poll in the test, vitest parallelism starving spawned subprocesses, or tmpdir/filesystem contention.
> 3. Prefer fixing by tightening synchronisation in the test (await the real state transition rather than a fixed timeout or racy poll). If that alone is insufficient, fall back to a LOCAL carve-out (e.g. mark just this file non-concurrent, isolate its tmpdir, give it its own pool/shard). Do NOT globally lower test concurrency. Do NOT touch `run` orchestration logic.
> 4. Verify by running `pnpm -r test` at least 20 times consecutively and confirming the assertion is stable; record the count.
> 5. Leave a short in-code or sibling-findings note explaining WHY the hardening exists, so it isn't reverted later.
> 6. Final gate: `pnpm format` then confirm `pnpm -r build && pnpm -r test && pnpm format:check` is green.
>
> Out of scope: refactoring `run`, changing unrelated tests, altering the acceptance gate command itself.