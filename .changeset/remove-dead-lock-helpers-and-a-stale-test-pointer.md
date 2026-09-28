---
'dorfl': patch
---

Remove dead item-lock code: the uncalled `amendHeldEntry` and `requeueItemLock` helpers, and the ref-write seam's `amendLockRef` method (with its exported `LockRefAmendInput` type), which nothing used. No behaviour changes.
