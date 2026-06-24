---
slug: needs-attention-test-cleanup-enotempty-flake
needsAnswers: false
---

2026-06-18 — saw `test/needs-attention.test.ts > readNeedsAttentionItems lists the stuck items with their reason` fail intermittently with `Error: ENOTEMPTY: directory not empty, rmdir '/tmp/dorfl-needs-attention-…/project'` from the `cleanup()` in `test/helpers/gitRepo.ts:102`. Re-running the file in isolation passes; full `pnpm -r test` was the failing site. Looks like a cleanup race between the test's still-finishing git/fs ops and `rmSync(root, {recursive: true, force: true})`, not a correctness issue. Out of scope for the de-overload-humanonly slice; flagging only.

## Applied answers 2026-06-22

### q1: How should this observation be discharged: promote to a slice that fixes the test-cleanup race in `test/helpers/gitRepo.ts:102` (e.g. await in-flight git/fs ops or retry `rmSync` on ENOTEMPTY), keep it as a live signal until the flake recurs, or delete it as too low-signal to act on?

promote-slice (small, localised). The cleanup race is real: the test-repo `cleanup()` does `rmSync(root, {recursive: true, force: true})` which can ENOTEMPTY when in-flight git/fs ops are still touching the tree. Fix: await in-flight ops before cleanup, or retry `rmSync` on ENOTEMPTY. Note the cited path is stale — the real `rmSync` is at `gitRepo.ts:150`, not `:102`; whoever writes the slice should update the reference. Disposition: promote-slice.

## Triaged: promoted

Promoted to a new backlog task `work/tasks/ready/needs-attention-test-cleanup-enotempty-flake.md` (a human answered
"promote"). This observation is resolved; the new item carries the work.
