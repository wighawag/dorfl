---
title: Serialise surface-treeless-moved-false.test.ts under parallel load (add to RACE_SENSITIVE)
slug: serialise-surface-treeless-moved-false-test-under-parallel-load
blockedBy: []
covers: []
---

## What to build

`test/surface-treeless-moved-false.test.ts` flakes (~1-in-7 full-suite runs) yet
passes reliably in isolation. It is a `start`/surface test that drives real git
against a `--bare` `file://` arbiter AND writes `main`, so it is the SAME
`git-file://-CAS-under-parallel-pressure` class already isolated via
`fileParallelism: false` for the `RACE_SENSITIVE` vitest project — but this file
was never added to that list. The product code is sound; only the TEST races
under file-parallel load.

Add `test/surface-treeless-moved-false.test.ts` to the `RACE_SENSITIVE` array in
`packages/agent-runner/vitest.config.ts` (with a one-line comment matching the
existing entries' style — it drives real git against a `--bare` arbiter and
writes `main`, same determinism reasoning as the sibling
`needs-attention-surface-on-main.test.ts` / start-on-main entries), so it runs in
the serial (`fileParallelism: false`) project instead of the file-parallel one.

This is the SAME fix already applied to every other start/surface-on-main test
that drives the `file://` arbiter CAS; it is a pure test-harness scheduling
change with no product-code impact.

## Acceptance criteria

- [ ] `test/surface-treeless-moved-false.test.ts` is listed in the
      `RACE_SENSITIVE` array in `packages/agent-runner/vitest.config.ts`, with a
      short comment in the established style explaining WHY (real git + `--bare`
      arbiter + writes `main` → keep out of file-parallel pressure).
- [ ] The test runs in the serial `RACE_SENSITIVE` vitest project (excluded from
      the file-parallel project), exactly as the sibling surface-on-main tests do.
- [ ] The full suite (`pnpm -r test`) is green; the previously-observed
      intermittent failure no longer reproduces across repeated full-suite runs.
      (The flaky assertion is the `moved:false` case — "a moved:false surface
      (seam stubbed) reports surface-unmoved, NOT a clean needs-attention" —
      which under file-parallel pressure occasionally saw `needs-attention`
      instead of the honest `surface-unmoved`. The `moved:true` happy-path test
      correctly EXPECTS `needs-attention`; do not mistake that for the failure.)
- [ ] No product source changes — this is a test-scheduling-only fix.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None — can start immediately.

## Prompt

> Goal: stop `test/surface-treeless-moved-false.test.ts` from flaking under
> full-suite parallel load by serialising it, exactly as the project already does
> for every other start/surface test that drives the `file://` arbiter CAS.
>
> FIRST, check this slice against current reality (it is a launch snapshot and may
> have DRIFTED): confirm `test/surface-treeless-moved-false.test.ts` still exists
> and is still ABSENT from the `RACE_SENSITIVE` array in
> `packages/agent-runner/vitest.config.ts`. If it has since been added (someone
> else fixed it), the flake is already addressed — route this slice to
> `needs-attention/` noting that, rather than making a no-op edit.
>
> Background / domain vocabulary: `RACE_SENSITIVE` is a list in
> `packages/agent-runner/vitest.config.ts` of test files that drive real git
> against a `--bare` `file://` arbiter AND write `main` (the compare-and-swap
> "ledger" pushes). Those tests are flaky under vitest's default file-parallelism
> because concurrent `file://` pushes contend on the same arbiter ref; the config
> puts every such file into a SEPARATE vitest project that runs with
> `fileParallelism: false` (serial), while everything else stays file-parallel.
> Each entry carries a one-line comment explaining why it is race-sensitive.
>
> The fix: add `'test/surface-treeless-moved-false.test.ts'` to the
> `RACE_SENSITIVE` array, with a comment in the SAME style as the neighbouring
> entries (it is a `start`/surface test that drives real git against a `--bare`
> arbiter and writes `main` via the surface-on-main path — same determinism
> reasoning as `needs-attention-surface-on-main.test.ts`). Do NOT touch the
> product code (`src/`) — the surface/`moved` logic is correct; only the test's
> scheduling is the problem (it passes 5/5 in isolation, fails ~1-in-7 under full
> file-parallel load).
>
> Seam to verify: run the full suite (`pnpm -r test`) repeatedly and confirm the
> previously-intermittent failure no longer reproduces, and that the file now
> executes within the serial `RACE_SENSITIVE` project rather than the
> file-parallel one. (The flaky assertion is in the `moved:false` test — it
> expects `surface-unmoved` but under parallel pressure occasionally saw
> `needs-attention`; the `moved:true` happy-path test correctly EXPECTS
> `needs-attention`, so do not read that as the failure.)
>
> Done = the file is in `RACE_SENSITIVE` with an explanatory comment, the full
> suite is green across repeated runs, no `src/` changes, and
> `pnpm -r build && pnpm -r test && pnpm format:check` passes.

## Needs attention

acceptance gate failed (exit 1) on the rebased tip

## Needs attention

continuing the kept work/slice-serialise-surface-treeless-moved-false-test-under-parallel-load: rebase onto the latest main conflicted (aborted, never auto-resolved) — resolve against the latest main, or `requeue --reset` to discard and start fresh
