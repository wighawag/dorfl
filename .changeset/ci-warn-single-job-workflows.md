---
'dorfl': patch
---

Warn about old single-job CI workflows: in GitHub Actions, an agent-spawning verb (`intake`, `advance`, `do`, `run`, `start`, `resume`, `work-on`, `complete`) run without `--phase`, in a checkout whose git config persists a credential (an `http.*.extraheader`, including one in a file pulled in by `includeIf`, or a URL with userinfo), now prints a prominent warning that any agent it launches can read that token, and that re-running `dorfl install-ci` upgrades the workflow. Behaviour is otherwise unchanged and the credential is never printed. `verify` is exempt (it launches no agent). The next minor version will turn this warning into a refusal.
