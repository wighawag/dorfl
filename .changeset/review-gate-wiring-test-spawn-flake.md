---
'dorfl': patch
---

Harden the Gate-2 review-gate wiring regression test against transient CI `spawnSync` fork failures.

`cli-complete-run-review-gate-wiring.test.ts` proves a `harness: pi` gate does NOT trip the null-adapter empty-`agentCmd` guard by stubbing `piBin: 'true'` and asserting the launch fails DOWNSTREAM as a `ReviewParseError` (empty verdict). Under a heavily-loaded CI runner `spawnSync` can instead fail the FORK itself with a transient `EAGAIN` ("failed to spawn pi …") — an environment flake, not the empty-`agentCmd` guard and not a wiring regression. The core invariant (the surfaced error is NEVER about `agentCmd`) is now asserted unconditionally, and the stronger `ReviewParseError` assertion is skipped only when the message is a transient spawn failure, so a fork hiccup no longer reddens the suite.
