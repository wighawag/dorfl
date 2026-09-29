---
'dorfl': patch
---

A CI phase run (`advance <item> --phase` for the build, tasking and tree-less paths, and `intake <N> --phase`) now prints each line once in its job log. The phase drivers no longer also note the result they return, which the CLI prints as the run's `>> ` or `error: ` line, so lines such as `>> handed over intake-task for issue:1` or `'<slug>' is already locked on origin; backing off.` no longer appear twice in a row. Every other progress line is still printed.
