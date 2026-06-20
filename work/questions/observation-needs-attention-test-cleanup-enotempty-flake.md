<!-- agent-runner-sidecar: item=observation:needs-attention-test-cleanup-enotempty-flake type=observation slug=needs-attention-test-cleanup-enotempty-flake allAnswered=false -->

## Q1

**How should this observation be discharged: promote to a slice that fixes the test-cleanup race in `test/helpers/gitRepo.ts:102` (e.g. await in-flight git/fs ops or retry `rmSync` on ENOTEMPTY), keep it as a live signal until the flake recurs, or delete it as too low-signal to act on?**

> Note (2026-06-18) flags an intermittent `ENOTEMPTY: directory not empty, rmdir '…/project'` from `cleanup()` in `test/helpers/gitRepo.ts:102` during `pnpm -r test` for `test/needs-attention.test.ts > readNeedsAttentionItems lists the stuck items with their reason`. Isolated re-run passes; suspected cleanup race between still-finishing git/fs ops and `rmSync(root, {recursive: true, force: true})`, not a correctness issue. Author explicitly scoped it out of the de-overload-humanonly slice and flagged only. Per WORK-CONTRACT, observations leave by deletion once a self-contained spawned artifact carries the signal, or by deletion when no longer useful.

_Suggested default: promote-slice — small, well-localised fix in `test/helpers/gitRepo.ts` (await pending ops or retry rmSync on ENOTEMPTY) with the mechanism+fix self-contained in the task body, then delete this note._

<!-- q1 fields: id=q1 disposition=promote-slice -->

**Your answer** (write below this line):
