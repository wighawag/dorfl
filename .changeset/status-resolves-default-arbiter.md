---
'dorfl': patch
---

`dorfl status` and `dorfl scan` resolve the current repo's arbiter the way `do`, `advance` and `requeue` do (`--arbiter`, else the per-repo/global `defaultArbiter`, default `origin`) instead of looking for a remote literally named `arbiter`, so a GitHub-hosted repo no longer reports "no 'arbiter' remote configured". A hosted arbiter is shown as hosted rather than "exists: no".
