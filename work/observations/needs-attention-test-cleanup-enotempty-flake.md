---
slug: needs-attention-test-cleanup-enotempty-flake
---

2026-06-18 — saw `test/needs-attention.test.ts > readNeedsAttentionItems lists the stuck items with their reason` fail intermittently with `Error: ENOTEMPTY: directory not empty, rmdir '/tmp/agent-runner-needs-attention-…/project'` from the `cleanup()` in `test/helpers/gitRepo.ts:102`. Re-running the file in isolation passes; full `pnpm -r test` was the failing site. Looks like a cleanup race between the test's still-finishing git/fs ops and `rmSync(root, {recursive: true, force: true})`, not a correctness issue. Out of scope for the de-overload-humanonly slice; flagging only.
