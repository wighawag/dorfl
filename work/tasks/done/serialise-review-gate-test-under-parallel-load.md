---
title: Serialise the flaky review-gate.test.ts out of file-parallel load (add it to the RACE_SENSITIVE project) so Gate-1 is deterministic now — complement to the source-fix slice, with the RACE_SENSITIVE bucket's meaning generalised
slug: serialise-review-gate-test-under-parallel-load
blockedBy: []
covers: []
---

## What to build

Make the acceptance gate (`pnpm -r test`) deterministic TODAY by pulling the known flaky `test/review-gate.test.ts` out of file-parallel pressure — adding it to the `RACE_SENSITIVE` list in `packages/dorfl/vitest.config.ts` (the second vitest project that runs `fileParallelism: false`). The test intermittently fails with `spawnSync bash EPIPE` ONLY under concurrent test load (it passes 28/28 in isolation); it has red a good gate at least four times, most recently reding the `slicing-coherence` keystone build's acceptance gate.

This is the "serialise now" HALF of the maintainer's "do both" decision. The OTHER half — fixing the underlying fragility so the test can eventually rejoin the parallel pool — is the SEPARATE, already-existing slice `null-harness-prompt-write-epipe-tolerant` (make `NullHarness.launch`'s piped-prompt write tolerant of an early-closed child stdin). This slice does NOT fix the source; it removes the flake from the gate's critical path immediately and cheaply.

Generalise the `RACE_SENSITIVE` bucket's MEANING while adding to it: today its doc-comment describes ONLY git-`file://`-CAS races, but `review-gate.test.ts`'s EPIPE is a spawn-stdin race — a different class. Update the comment so the list reads as "tests that flake under file-parallel load" (CAS races AND spawn-stdin races), with a one-line note on WHY `review-gate.test.ts` is here (the EPIPE flake

- a pointer to the observation), so the bucket's widened meaning is legible and the next author does not re-narrow it.

## Acceptance criteria

- [ ] `test/review-gate.test.ts` is added to the `RACE_SENSITIVE` list in `packages/dorfl/vitest.config.ts` (it now runs in the `fileParallelism: false` project, off the parallel-load critical path).
- [ ] The `RACE_SENSITIVE` doc-comment is generalised from "git-`file://`-CAS races" to "tests that flake under file-parallel load" (covering both the CAS races and this spawn-stdin EPIPE), with a one-line per-entry note for `review-gate.test.ts` pointing at the EPIPE observation.
- [ ] `pnpm -r test` still passes with the test in its new project (no test was dropped or skipped — it RUNS, just serialised).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. (Independent of the `slicing-coherence` chain and of the source-fix slice `null-harness-prompt-write-epipe-tolerant`; they are complementary and may land in either order. Touches only `vitest.config.ts`.)

## Prompt

> Serialise the known-flaky `test/review-gate.test.ts` out of file-parallel load by adding it to the `RACE_SENSITIVE` list in `packages/dorfl/vitest.config.ts` (the second vitest project with `fileParallelism: false`), making the acceptance gate deterministic now. This is the "serialise now" half of a "do both" decision — the source-fix half is the SEPARATE existing slice `null-harness-prompt-write-epipe-tolerant`; do NOT do the source fix here.
>
> CONTEXT: `test/review-gate.test.ts > … "substitutes reviewModel through the null/shell {model} placeholder"` intermittently throws `failed to spawn harness command: spawnSync bash EPIPE` (from `NullHarness.launch`, `src/harness.ts`) ONLY under heavy concurrent test load — it passes 28/28 in isolation. It is a spawn-stdin race (the `printf` child closes stdin before the parent writes the empty prompt), NOT a product bug. Full history + the maintainer's "do both" decision: `work/observations/review-gate-test-epipe-under-parallel-load.md`.
>
> WHERE TO LOOK: `packages/dorfl/vitest.config.ts` — the `RACE_SENSITIVE` array and its doc-comment (it already serialises the git-`file://`-CAS-race files like `claim-cas.test.ts` / `slicing-lock.test.ts` / `slicing.test.ts` / `slicing-integration.test.ts` into a `fileParallelism: false` project). Add `'test/review-gate.test.ts'` to that array.
>
> GENERALISE THE BUCKET: the `RACE_SENSITIVE` doc-comment currently frames the list as the git-`file://`-CAS bucket. Adding a spawn-stdin flake WIDENS its meaning, so update the comment to "tests that flake under file-parallel load" (CAS races AND spawn-stdin races) and add a one-line note next to the new entry explaining WHY `review-gate.test.ts` is here (the EPIPE flake) with a pointer to the observation — so the next author doesn't re-narrow the bucket or wonder why a non-git test is in it.
>
> SCOPE FENCE: do NOT fix the underlying EPIPE in `NullHarness.launch` (that is the `null-harness-prompt-write-epipe-tolerant` slice). Do NOT skip, delete, or `retry`-wrap the test — it must still RUN, just serialised. Do NOT move any other test into or out of `RACE_SENSITIVE`.
>
> FIRST run the drift check: confirm `review-gate.test.ts` is NOT already in `RACE_SENSITIVE` and that the EPIPE flake hasn't already been source-fixed (if the `null-harness-prompt-write-epipe-tolerant` slice has landed and the test is reliably green in parallel, this serialise may be unnecessary — note it and proceed only if the flake still applies, else route to `needs-attention/` with the discrepancy).
>
> "Done" = `review-gate.test.ts` runs in the serialised `RACE_SENSITIVE` project, the bucket's doc-comment is generalised to "flakes under file-parallel load", the test still runs (not skipped), and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

---

## Provenance

Promoted from the "Open question — should Gate-1 also SERIALISE this test?" section of `work/observations/review-gate-test-epipe-under-parallel-load.md` (2026-06-08). That observation also tracks the source-fix slice `null-harness-prompt-write-epipe-tolerant`; this slice is the complementary "serialise now" half. Do NOT delete the observation when this lands — it stays until the source-fix slice lands too (it tracks both halves).
