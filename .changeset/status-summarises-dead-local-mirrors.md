---
'dorfl': patch
---

`dorfl status` and `dorfl scan` no longer print one multi-line fetch warning per registered mirror whose local arbiter no longer exists. Such mirrors are not fetched, are still read from their last-known state, and are reported together on one line with the count, a few examples and the `dorfl remote rm <origin-url>` command. Nothing is removed automatically. The test suite now points `HOME` at a scratch directory for every test file, so no test can create mirrors in the real `~/.dorfl` again.
