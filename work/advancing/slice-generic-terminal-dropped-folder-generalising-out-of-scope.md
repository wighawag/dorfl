---
entry: slice-generic-terminal-dropped-folder-generalising-out-of-scope
by: agent-runner[bot]
---

Advancing lock held for `slice-generic-terminal-dropped-folder-generalising-out-of-scope`. This is a TRANSIENT borrow — the
advance surface/apply/triage rung holds it and releases it; if it is here
after a run, a tick died mid-borrow and it can be removed.
