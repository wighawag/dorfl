---
title: null-harness-prompt-write-epipe-tolerant — make NullHarness's piped-prompt write robust to an early-closed child stdin so review-gate.test.ts stops flaking with spawnSync bash EPIPE under parallel load
slug: null-harness-prompt-write-epipe-tolerant
covers: []
---

> Self-contained test-flake/robustness slice \u2014 derives from NO PRD (`covers: []`),
> omits `prd:`. Source signal:
> `work/observations/review-gate-test-epipe-under-parallel-load.md` (recurrence
> consolidated 2\u00d7, past the "second instance is a signal" threshold).

## What to build

`review-gate.test.ts > … substitutes reviewModel through the null/shell {model}
placeholder` intermittently fails the full `pnpm -r test` run with
`failed to spawn harness command: spawnSync bash EPIPE` (thrown from
`NullHarness.launch`, ~`src/harness.ts:230`/`236`). It PASSES reliably in isolation
\u2014 it is a parallel-load timing flake: the null adapter's
`spawnSync('bash', ['-c', 'printf …'])` path writes the (EMPTY) prompt to the child
via `input:`, and under heavy concurrent load the `printf` child closes stdin
before the parent's write, surfacing as EPIPE.

Make the null adapter's piped-prompt write ROBUST to an early-closed child stdin:
treat an `EPIPE` on the prompt write as benign (the prompt here is empty / already
consumed), rather than letting `spawnSync`'s `result.error` throw. Keep all OTHER
spawn errors throwing (only `EPIPE` on this path is benign). The pi adapter and the
interactive-launch path are UNAFFECTED (no piped prompt) \u2014 do not touch them.

## Acceptance criteria

- [ ] `NullHarness.launch` no longer throws on an `EPIPE` from the empty-prompt
      `spawnSync` write; non-EPIPE spawn errors still throw (assert both).
- [ ] The `review-gate.test.ts` reviewModel-placeholder test is stable under
      parallel load (no EPIPE flake); a targeted unit test simulates/asserts the
      EPIPE-tolerant path on the null adapter.
- [ ] The pi adapter + interactive launch are untouched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green (run the full
      suite a few times to confirm the flake is gone).

## Blocked by

- None.

## Prompt

> Fix the intermittent `spawnSync bash EPIPE` flake in `review-gate.test.ts` by
> making `NullHarness.launch`'s piped-prompt write tolerant of an early-closed child
> stdin. Source: `work/observations/review-gate-test-epipe-under-parallel-load.md`.
>
> ROOT CAUSE: the null/shell adapter does `spawnSync('bash', ['-c', command],
> {input: input.prompt, …})` (~`src/harness.ts:228`) and throws on ANY
> `result.error` (~line 230). Under concurrent load the `printf` child closes stdin
> before the empty-prompt write \u2192 `EPIPE`. The prompt is EMPTY here, so the write
> failing is harmless.
>
> FIX: treat `EPIPE` on this write as benign (do not throw; proceed as if the launch
> succeeded with empty output) while keeping every OTHER `result.error` throwing.
> Verify the exact error shape (`result.error?.code === 'EPIPE'`). Add a unit test
> that asserts EPIPE is tolerated and a non-EPIPE error still throws.
>
> SCOPE FENCE: null/shell adapter's captured-launch path ONLY. Do NOT touch the pi
> adapter or the interactive (`stdio: 'inherit'`) path \u2014 they have no piped prompt.
>
> DRIFT CHECK FIRST: confirm `NullHarness.launch` still uses `spawnSync` with
> `input:` and throws unconditionally on `result.error`. If it already tolerates
> EPIPE, close this slice.
>
> "Done" = the flake is gone (full suite stable across repeated runs), EPIPE is
> tolerated on the empty-prompt write, other errors still throw, pi/interactive
> untouched, and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
