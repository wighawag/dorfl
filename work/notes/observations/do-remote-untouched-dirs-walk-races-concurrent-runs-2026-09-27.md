# The `do --remote` untouched-dirs test bounced an unrelated task by racing concurrent runs in the real `~/.dorfl`

Date: 2026-09-27
Observer: builder re-running `ci-split-build-path` after its requeue.

The `ci-split-build-path` land gate (fresh worktree, 2026-09-27 19:57) failed with 1 of 3843 tests red: `test/do-remote.test.ts`, with the stack deep inside the recursive `walk` of `listAllFiles` (line 91). The branch's full suite passes unchanged on re-run (264 files, 3843 tests), so the failure was not caused by the task. The likely cause is `readdirSync` (not inside the `try`) throwing when a directory under the REAL `~/.dorfl` disappears mid-walk, because other dorfl runs and fresh-gate worktrees create and reap directories there concurrently. This adds to `do-remote-untouched-dirs-test-walks-the-real-dorfl-home.md`: besides being slow, the walk is non-deterministic under concurrent runs, and it now bounces unrelated tasks at land time.
