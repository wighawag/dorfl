## Context

Gate-2 review of `test-cross-job-concurrent-land` (2026-06-26) APPROVED but flagged a
non-blocking drift between comment and code in the cross-job concurrent-land test
harness. The human triaged the observation
(`work/observations/review-nits-test-cross-job-concurrent-land-2026-06-26.md`) and
chose **option (a)**: remove the dead code and correct the lying docblock, rather
than wire past-cap through `serialiseAfter` for determinism. Past-cap determinism
was not flagged as required by review; the current race-rendezvous behaviour is
intended.

The defect is small but real: the worker exposes a `serialiseAfter` parameter
(waits for a `done-<other>` marker before proceeding) that no test actually
passes, and the past-cap `it()` in the test file races both workers with `cap=0`
and lets CAS pick the loser. Meanwhile the top-of-file docblock in the test
claims past-cap 'serialises one worker behind a done-<other> marker'. Code and
comment disagree; the parameter is dead weight and a future-reader trap.

## Scope (self-contained)

1. **`packages/dorfl/test/helpers/cross-job-land-worker.ts`**
   - Remove the `serialiseAfter` parameter from the worker's argument parsing / CLI
     surface.
   - Remove the `pollUntil(serialiseAfter)` gate and any associated imports /
     helpers that become unused as a result.
   - Leave the rest of the worker (mergeJitterMs:0, freshWorktreeGate:true, etc.)
     UNCHANGED — those are separate deliberate test-scaffolding choices recorded
     in the observation and explicitly out of scope here.

2. **`packages/dorfl/test/cross-job-concurrent-land.test.ts`**
   - Rewrite the top-of-file docblock (around lines 36–42) so it accurately
     describes the past-cap case as a race-rendezvous with cap=0 where CAS
     picks the winner and the loser retries — matching the actual `spawnWorker`
     call in the past-cap `it()`, which passes no `serialiseAfter`.
   - Do NOT add a `serialiseAfter` argument to the past-cap test; past-cap
     determinism is intentionally not a requirement here (see
     `clean-rebase-semantic-break.test.ts` for the deterministic broken-merge
     coverage).

## Non-goals / out of scope

- Do NOT wire past-cap through a serialisation marker for determinism — the
  human explicitly rejected that option.
- Do NOT touch the other in-scope test-scaffolding choices flagged in the
  observation (mergeRetries=1000, mergeJitterMs=0, freshWorktreeGate=true,
  verify body 'exit 0', TSX_BIN path). They stand as recorded in the observation.
- Do NOT change any product code under `packages/dorfl/src/**`.

## Acceptance

- `rg -n 'serialiseAfter' packages/dorfl` returns no hits.
- The past-cap docblock in `cross-job-concurrent-land.test.ts` describes the
  race-rendezvous behaviour truthfully (no mention of `done-<other>`
  serialisation for past-cap).
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.
- The `test-cross-job-concurrent-land` suite still passes with the same
  observable semantics (within-cap: both land; past-cap: one lands, one loses
  the CAS race).

## Provenance

Spun out of
`work/observations/review-nits-test-cross-job-concurrent-land-2026-06-26.md`
(Gate-2 non-blocking nit #1). Nit #2 of that observation (the (a)–(e)
in-scope-choice list) is intentionally NOT part of this task — the human
kept it as a durable note in the observation itself, to be escalated only
if one of those choices later bites (e.g. the `node_modules/.bin/tsx`
coupling breaking CI on a different layout).

## Prompt

> Build the task 'cleanup-cross-job-worker-serialiseafter-dead-branch', described above.
