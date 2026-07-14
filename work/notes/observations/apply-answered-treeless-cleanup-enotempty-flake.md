---
needsAnswers: true
---

# Flaky ENOTEMPTY on `advance-in-place-publishes-treeless-results` apply-answered test

Date: 2026-07-14
Observer: task `apply-resolve-reset-flag-discards-work-branch` build.

Seen once during `pnpm --filter dorfl test`:

```
FAIL  test/advance-in-place-publishes-treeless-results.test.ts >
  advance in-place ... > APPLY: an answered blocker sidecar applied in-place
  ff-pushes the resolved item to arbiter/main
Error: ENOTEMPTY: directory not empty, rmdir
  '/tmp/dorfl-advance-in-place-publishes-treeless-xjsnld/apply-answered/project-work.git/objects'
```

Re-running the same file passed cleanly — looks like an afterEach `rmrf`
racing an open filehandle inside the bare `project-work.git`, not a
correctness failure. Not investigated further; outside this task's scope.
