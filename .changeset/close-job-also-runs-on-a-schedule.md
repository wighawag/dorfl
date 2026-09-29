---
'dorfl': patch
---

The close-job workflow `install-ci` generates now also runs hourly and on `workflow_dispatch`, next to its `push` to `main` trigger. GitHub starts no workflow for a push made with a job's `GITHUB_TOKEN`, so a land the CI pushed itself (merge mode, an answered `merge` question) never closed its issue. `dorfl close-merged-issues` now skips an issue that is already closed: it reports it as `already closed`, does not close or comment on it again, and does not count it in `closed N issue(s)`. Re-run `install-ci` to pick up the new triggers.
