# `pre-backlog-staging-and-promote.test.ts` still materialises hub mirrors in the REAL `~/.dorfl/repos/tmp/`

Date: 2026-09-28
Observer: builder of `do-remote-untouched-test-stops-walking-the-real-home` (carried over from the now-discharged `do-remote-untouched-dirs-test-walks-the-real-dorfl-home` note, whose other signal that task fixed).

On telemaque `~/.dorfl/repos/tmp/` holds 372 `pre-backlog-step-a-*` dirs, the newest created 2026-09-28 10:12, each containing `project-work.git`. That is the hub-mirror key of a `file:///tmp/pre-backlog-step-a-XXXX/project-work.git` arbiter, so the test's scratch is already a `makeScratch` temp dir (the earlier note's "route it to scratch" guess is stale) but some `performTask` path in `packages/dorfl/test/pre-backlog-staging-and-promote.test.ts` still resolves a DEFAULT `workspacesDir` (`homedir()/.dorfl`) and mirrors into the real home. Unverified which call; the existing leftovers were NOT deleted (they are in the developer's real state root).
