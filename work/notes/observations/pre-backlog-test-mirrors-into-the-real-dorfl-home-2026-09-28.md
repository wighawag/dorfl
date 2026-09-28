# `pre-backlog-staging-and-promote.test.ts` still materialises hub mirrors in the REAL `~/.dorfl/repos/tmp/`

Date: 2026-09-28
Observer: builder of `do-remote-untouched-test-stops-walking-the-real-home` (carried over from the now-discharged `do-remote-untouched-dirs-test-walks-the-real-dorfl-home` note, whose other signal that task fixed).

On telemaque `~/.dorfl/repos/tmp/` holds 372 `pre-backlog-step-a-*` dirs, the newest created 2026-09-28 10:12, each containing `project-work.git`. That is the hub-mirror key of a `file:///tmp/pre-backlog-step-a-XXXX/project-work.git` arbiter, so the test's scratch is already a `makeScratch` temp dir (the earlier note's "route it to scratch" guess is stale) but some `performTask` path in `packages/dorfl/test/pre-backlog-staging-and-promote.test.ts` still resolves a DEFAULT `workspacesDir` (`homedir()/.dorfl`) and mirrors into the real home. Unverified which call; the existing leftovers were NOT deleted (they are in the developer's real state root).

## Later datum (2026-09-28, conductor of the fix-task drive)

The leak is still growing: `~/.dorfl/repos/tmp/` went from 372 to 476 `pre-backlog-step-a-*` dirs over one day's drive (about a dozen gate runs). It also has a visible user-facing cost. `dorfl status` treats each leaked dir as a registered mirror whose `file:///tmp/...` arbiter is gone, so it prints one "could not fetch mirror ... reading last-known state (offline)" warning per dir before the dashboard. With hundreds of dirs, the real output is buried. The leaked dirs are still on disk (not the agent's to delete unasked).
