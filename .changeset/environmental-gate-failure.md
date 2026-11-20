---
'dorfl': patch
---

An acceptance gate that fails because a port it needs is already in use (`EADDRINUSE`, "address already in use", Playwright's "http://localhost:4273 is already used", "port N is in use") is retried after a wait (30 s, then 90 s; set `DORFL_GATE_ENV_RETRY_DELAYS_MS`, comma-separated, empty to disable). If it persists, the failure is reported as ENVIRONMENTAL, not the work, and the surfaced question asks whether to retry once the machine is clear (default `retry`) instead of "how should we proceed?". A genuine failure is never retried.
