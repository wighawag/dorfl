---
'dorfl': patch
---

`strictMergeApproval` now actually re-surfaces an answered merge when `main` moved. A merge question records the arbiter `main` it was asked against (`askedAtMain=<sha>` in its sidecar entry comment), set by the merge-question surfacer and by the re-surface path. With `strictMergeApproval: true`, both the laptop apply and the CI agent job compare that base with the current `main` BEFORE the kept branch's continue rebase (before, the check ran after the rebase and could almost never fire), and re-surface the question when anything outside `work/` changed. Questions, answers and other ledger commits under `work/` do not count, so a first answer given against the current `main` lands, and a re-answer given while `main`'s code stays put lands too, in CI as well as on the laptop (the re-surfaced question records the new base, so there is no re-stale livelock). A merge question written before this change carries no base and keeps the old behaviour (no re-stale).
