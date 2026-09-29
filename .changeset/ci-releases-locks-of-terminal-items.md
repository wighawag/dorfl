---
'dorfl': patch
---

`dorfl gc --remote-branches` now also releases every per-item lock whose item is already terminal on the arbiter's `main` (a task in `tasks/done/` or `tasks/cancelled/`, a spec in `specs/tasked/` or `specs/dropped/`). This is the same reconcile `dorfl status --reconcile-locks` performs: each delete is leased on the sha that was read (a lock that changed in between is kept and reported, never forced), and a lock whose item is not terminal is never touched. Because the scheduled `reap-merged-branches` CI job already runs this command, the locks that merged propose PRs leave behind no longer accumulate on the arbiter; the generated workflows are unchanged. `--dry-run` reports which locks would be released, the job log lists each `[released]` lock, and `--json` carries them under `terminalLocks`.
