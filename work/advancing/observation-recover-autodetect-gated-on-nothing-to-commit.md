---
entry: observation-recover-autodetect-gated-on-nothing-to-commit
by: agent-runner[bot]
---

Advancing lock held for `observation-recover-autodetect-gated-on-nothing-to-commit`. This is a TRANSIENT borrow — the
advance surface/apply/triage rung holds it and releases it; if it is here
after a run, a tick died mid-borrow and it can be removed.
