# A full `pnpm -r test` run once died with a V8 heap OOM in a vitest worker

2026-09-27, seen while re-verifying `ci-split-handoff-artifact-format`: the first `pnpm -r test` after a fresh `pnpm install` + `pnpm -r build` in the task worktree ended with `FATAL ERROR: Ineffective mark-compacts near heap limit ... JavaScript heap out of memory` (252 of 253 files passed, 3590 of 3596 tests reported), then two immediate reruns passed all 253 files / 3596 tests. Unverified cause (memory pressure on the host, or a leaky test file); worth watching if the gate bounces the same way again.
