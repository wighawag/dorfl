---
type: observation
status: spotted
date: 2026-07-12
---

# `test/merge-retries-external.test.ts` flakes on the cap-0 bounce assertion

Noticed while running the acceptance gate for
`promote-rename-cutover-lessons-to-findings-note` (docs-only task; no code
change on the branch). One `pnpm -r test` run failed with:

```
FAIL packages/dorfl test/merge-retries-external.test.ts
  > mergeRetries (resolved through config) — cap controls bounce vs converge
  > with the resolved cap at 0, two disjoint-file same-repo merges do NOT both cleanly land (a contender bounces to needs-attention)
AssertionError: expected 2 to be less than or equal to 1
  at test/merge-retries-external.test.ts:122:18
```

Re-running just that file (`pnpm exec vitest run test/merge-retries-external.test.ts`)
passed cleanly (2/2). Nothing on this branch touches merge/retries code, so
this looks like a real timing/order flake in that external-process test rather
than damage from the current task. Out of scope here — capturing so the signal
is not lost.
