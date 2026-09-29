---
'dorfl': patch
---

A continue rebase of a kept `work/*` branch that does not apply now reports its real cause. A genuine conflict names the conflicting paths and the `main` sha it rebased onto; any other failure (for example a missing committer identity) says it failed without a conflict and quotes git, instead of being called "conflicted". This reaches the needs-attention reason of `run`, `do`, `start`, `requeue --reconcile` and the answered merge. The CI agent job of an answered merge also no longer fails that rebase for lack of a committer identity: its hub-mirror job worktree now commits with the identity the workflow configured in the checkout.
