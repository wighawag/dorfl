---
'dorfl': patch
---

Groundwork for the CI split where the agent job holds no write token: a hidden, CI-only `--phase lock|agent|apply` option on `intake`, `advance` and `do` (refused outside GitHub Actions; without it nothing changes). In the lock and apply phases dorfl refuses to launch an agent or run `prepare` / `verify`; in the agent phase every write seam records the first write and halts instead of performing it, and dorfl's own git commands carry the job's read token per command (`GIT_CONFIG_*`, never `.git/config`, never in an agent's environment). New exports: `AGENT_SPAWNING_VERBS`, the phase guards and the recording seams. No workflow uses `--phase` yet.
