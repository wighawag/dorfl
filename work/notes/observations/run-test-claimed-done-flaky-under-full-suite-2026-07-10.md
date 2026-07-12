---
needsAnswers: true
---

# `run.test.ts` `claimed-done` assertion is flaky under full-suite parallelism

Date: 2026-07-10

Noticed while running the acceptance gate for `hard-cutover-remove-last-prd-back-compat-key-and-dead-verb`. `packages/dorfl/test/run.test.ts:633` (`expect(result.items[0].status).toBe('claimed-done')`) intermittently fails when the WHOLE suite runs (`pnpm -r test` / `pnpm test`), roughly 1 run in 2, but passes 39/39 consistently when `run.test.ts` is run in isolation (verified 3x). This test spawns real throwaway git repos + agents, so it looks like resource contention / a timing race under the full-suite concurrency, NOT a logic bug. Unrelated to this task's changes (frontmatter parsing, prose, and leak-scan test files — none touch `run` orchestration). Left as-is per scope; flagged for whoever owns test-suite flakiness.
