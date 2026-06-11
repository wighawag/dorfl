# ADR `command-surface-and-journeys` §3 — flip the `--isolated` "pending build" marker

2026-06-11 — Slice `do-isolated-in-place` shipped `do --isolated <slug>` (the
boolean isolate-off-my-own-arbiter form). `docs/adr/command-surface-and-journeys.md`
§3 ("Isolation strategy by form", ~L63) still reads **"the `--isolated` form is
pending build (slice `do-isolated-in-place`) — the in-place and `--remote` forms
ship today."** That caveat is now stale: drop the "pending build" clause so the
bullet reads `--isolated` as a shipped form alongside in-place / `--remote` (the
table itself is already correct). One small doc edit; left as a follow-up per the
slice (the slice deliberately did not touch the ADR).
