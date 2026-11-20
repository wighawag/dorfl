---
'dorfl': patch
---

`requeue <slug> -m "<instruction>"` now works on a surfaced item whose lock the surface already released, which is the common case after a red gate. The note is written as the answer to the pending question and applied the way `advance` would (`needsAnswers` cleared, the sidecar removed, the answer recorded), plus the usual `## Requeue` section the continue prompt reads, so the next `do task:<slug>` picks the item up and continues from the kept branch. A released item with no pending question gets the plain note, as before.
