---
'dorfl': patch
---

A merge-mode land in the CI apply phase (`--phase apply`) now says when it landed a tree the acceptance gate never saw. The compare-and-swap loop that lands on `main` re-rebases and retries after a lost race but never re-runs the gate, and after the CI split the apply job's first push usually loses that race, because the agent job gated minutes earlier. When the landed tip's tree differs from the gated tip's tree (the bundle tip), the run output says "`<branch>` landed without re-gate after N lost races" and the landed commit carries a `Landed-Without-Regate: landed without re-gate after N lost races` git trailer. A land that won its first push, or whose re-rebase kept the gated tree, carries neither. Propose mode is unaffected, and so is every land without `--phase` (`do`, `complete`, `run`): their landed commits are never rewritten.
