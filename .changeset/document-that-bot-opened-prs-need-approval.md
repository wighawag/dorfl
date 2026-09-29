---
'dorfl': patch
---

`dorfl install-ci`'s closing summary now explains that GitHub holds the `verify` run of a pull request opened with `GITHUB_TOKEN` in `action_required` until someone with write access approves it. When no `DORFL_GH_TOKEN` was set in the run it recommends that secret for advance (build, tasking) pull requests; either way it notes that intake pull requests always need the approval, because `intake.yml` keeps the built-in token. `docs/ci/README.md` gains a section on the behaviour, how to approve a run, and the `DORFL_GH_TOKEN` trade-off.
