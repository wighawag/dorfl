---
'dorfl': patch
---

Fix `complete --review` and a `run`-tick review throwing "empty agentCmd — nothing would run" under `harness: pi`. Both commands built their Gate-2 (PR/code review) gate as an arg-less `harnessReviewGate()`, which defaulted to a `NullHarness` + empty `agentCmd` and tripped the empty-command backstop whenever `--review` was on — even though the pi adapter does not consume `agentCmd` (only the null/shell adapter does). They now resolve and thread `{harness, agentCmd}` exactly as the `do` command already does (via `createHarness({harness, piBin})`), so the pi-backed review gate runs. This unblocks the designated re-integration path after a Gate-2 bounce: fixing a review block on the pushed `work/<slug>` branch and re-running `dorfl complete <slug> --review` now re-reviews through the configured harness instead of forcing `--no-review`. The `--isolated` complete recovery path wires no review gate and is unaffected.
