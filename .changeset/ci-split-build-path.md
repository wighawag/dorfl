---
'dorfl': patch
---

The CI split where the agent job holds no write token now covers the build path's success case: `do <task>` and `advance task:<slug>` run as a lock, an agent and an apply phase under the hidden, CI-only `--phase` (with `--handoff-out` / `--handoff-in` for the artifact directory, and the lock job's outputs read back from `DORFL_LOCK_OUTPUTS`). The lock phase classifies the item at the arbiter's current `main` and claims it; the agent phase builds, gates, reviews and rebases exactly as before, then hands the work over as a bundle instead of pushing; the apply phase validates that handoff as hostile, lands it with the unchanged merge-mode retry loop (or opens the PR and posts the review comment) and releases the lock only while it still holds the sha the lock job produced. Other build outcomes are surfaced to needs-attention for now. No generated workflow uses `--phase` yet, and nothing changes without it.
