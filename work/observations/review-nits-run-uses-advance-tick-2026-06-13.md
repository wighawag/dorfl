---
title: review-gate non-blocking nits for 'run-uses-advance-tick' (Gate 2 approve)
date: 2026-06-13
status: open
slug: run-uses-advance-tick
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'run-uses-advance-tick' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Criterion 3 asks for a concurrency test asserting the parallel `advancing`-borrow no-double-advance IN THIS SLICE; the new test file has none. Confirm that relying on the precursor's `advance-registry-set.test.ts` (which proves exactly that, on the `advanceRegistrySet` layer this adapter calls 1:1) is acceptable rather than re-asserting it through `runLoop`.
  (The slice criterion says 'Reuse the precursor's borrow semantics; do NOT invent a new lock' — and the adapter does exactly that (a thin passthrough, no new lock). The borrow concurrency lives entirely in `advanceRegistrySet`/`performAdvance`, where the precursor's 'two concurrent registry-set batches over the SAME mirror => exactly ONE winner per item' test pins it. The adapter adds no concurrency of its own, so a `run`-level re-proof would be redundant, but the criterion's literal wording asked for one here.)
- The slice asked the agent to RECORD the `--advance`-alias / `--build-only` decision in a '## Decisions' block; the slice file has none. Ratify the landed decision: plain `run` becomes advance, `run --advance` is a deprecated no-op alias (warns, ignored, no longer takes a `<mirror>` value), and NO `--build-only` escape is added.
  (This is a user-visible default + a cross-slice/flag-behaviour change. It matches the slice's stated default position and is documented in cli.ts, the ADR, and the PRD, so it is ratifiable as-is — but it was never written into a Decisions block for the human to sign off, and it silently breaks the old value-bearing `run --advance <mirror>` invocation form (now ignored). No test asserted that old form, so nothing regresses in the suite.)
- `run --once` now debug-ticks the ADVANCE tick (one registry-set advance batch); the build-only `runOnce` tick is no longer reachable from the CLI at all (`const result = await advanceTick({...})`, the old `advanceTick ?? runOnce` fallback is gone). Ratify that `--once` debugging the advance tick (not a build-only tick) is the intended behaviour.
  (Consistent with the slice premise ('--once debug-ticks the looped tick' and the looped tick IS now advance). Under calm gates the outcome is equivalent to the old build tick, so this is behaviour-preserving by construction; flagged only because it is an in-scope behaviour choice on a sibling flag (`--once`) the slice prose did not call out explicitly.)
- `runOnce` is still imported in cli.ts (line 23) but is now referenced only in JSDoc `{@link}` comments, not in any executable code. Consider dropping the value import to avoid a dead binding.
  (The project's tsconfig does not set `noUnusedLocals`, so the build stays green. Purely a cleanliness nit; harmless because the JSDoc links keep the name meaningful.)
- The new test's `contextForFactory` clones the treeless cwd from `originUrl` (the arbiter), whereas the CLI's `buildRegistrySetAdvanceTick` clones it from `mirrorPath` (the bare hub mirror). The surface/triage/apply rungs commit into this clone and the advancing-lock pushes to its `origin`. Confirm the surfaced commit propagates back to the real upstream (mirror sync), since the CLI's treeless clone is `rmSync`'d at the start of the next tick.
  (The gate-on test asserts only the LOCAL working-tree write (the question file exists in the treeless clone), so it does not exercise the exact CLI remote (`mirrorPath`) nor the push-back-to-arbiter path. This matches how the single-mirror path committed-in-cwd-and-let-the-lock/integration-band-propagate, and how the precursor's own tests are shaped, so it is a known substrate property rather than a defect introduced here — but the test fidelity to the CLI wiring is partial and worth a human eyeball on the mirror-sync of surfaced questions.)
