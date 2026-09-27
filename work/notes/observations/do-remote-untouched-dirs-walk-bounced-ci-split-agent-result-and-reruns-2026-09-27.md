# The `do --remote` untouched-dirs walk bounced a second unrelated task the same day

Date: 2026-09-27
Observer: builder re-running `ci-split-agent-result-and-reruns` after its requeue.

The land gate for `ci-split-agent-result-and-reruns` (fresh worktree, 21:25) failed with 1 of 3884 tests red in `test/do-remote.test.ts`, inside the recursive `walk` of `listAllFiles` (line 91), the same signature as `do-remote-untouched-dirs-walk-races-concurrent-runs-2026-09-27.md`. The branch's unchanged full suite passes on re-run (265 files, 3884 tests). Second bounce from this flake in one day, so it is now a recurring land-time cost, not a one-off.
