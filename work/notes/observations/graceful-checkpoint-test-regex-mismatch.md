---
needsAnswers: true
---

# graceful-pre-timeout-checkpoint test: regex expects `${{ needs… }}`, source emits `${{ fromJson(needs…) }}`

Date: 2026-07-13

`test/graceful-pre-timeout-checkpoint.test.ts` line ~130 asserts:

```
/timeout-minutes:\s*\$\{\{\s*needs\.enumerate\.outputs\.githubTimeout\s*\}\}/
```

on the workflow text emitted by `generateAdvanceLifecycleWorkflow`. But the
template at `packages/dorfl/src/advance-lifecycle-template.ts:383,450` renders
`timeout-minutes: ${{ fromJson(needs.enumerate.outputs.githubTimeout) }}` (the
`fromJson(...)` wrapper is present in the source but NOT in the test regex).

Confirmed pre-existing on `origin/main` (fails without any of the PR-2b changes).
Out-of-scope for this task; leaving as-is.
