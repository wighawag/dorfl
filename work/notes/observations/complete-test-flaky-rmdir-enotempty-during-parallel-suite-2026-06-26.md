---
title: complete.test.ts > `isLocalBranchProvablyOnArbiter` flakes with `ENOTEMPTY: rmdir '.../project/.git'` under the full parallel suite
date: 2026-06-26
---

While running the full `pnpm -r test` during the `merge-question-surfacer` task, the
test "false when the remote tip differs from the local tip (un-pushed amend)" in
`packages/dorfl/test/complete.test.ts` failed with
`ENOTEMPTY: directory not empty, rmdir '/tmp/dorfl-complete-.../project/.git'`.

Running `pnpm exec vitest run test/complete.test.ts` in isolation passes all 31
tests cleanly, so the failure looks like a cross-file race in the scratch-repo
teardown (another parallel test still has a file open under that `.git/`
directory when the per-test cleanup tries to `rmSync` the scratch root). Out of
scope for the surfacer task — just leaving the signal.
