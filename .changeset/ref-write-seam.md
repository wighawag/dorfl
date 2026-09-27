---
'dorfl': patch
---

Internal refactor, no behaviour change: every network write a CI path can reach now goes through a write seam. The lock ref pushes, the continued work-branch push, the deadline checkpoint's branch save, the remote work-branch delete, the tasking candidates branch push and the tree-less `main` publish now go through a new `refWrite` seam (exported with `currentRefWrite` and the `RefWriteStrategy` type), next to `ledgerWrite`. A test fails if a new direct `git push` or `gh` write appears outside the seams. This prepares the CI split where the agent job holds no write token.
