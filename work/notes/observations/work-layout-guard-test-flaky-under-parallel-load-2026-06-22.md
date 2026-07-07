---
needsAnswers: true
---

# work-layout-guard.test.ts flakes under full parallel `pnpm -r test`

2026-06-22. During the `rename-config-keys-slicing-to-tasking` task, one full
`pnpm -r test` run reported a single failure in
`test/work-layout-guard.test.ts > NO src/ file except work-layout contains a raw
work/<folder> path literal`, while every other run (and the test in isolation, 3x)
passed (2585/2585). The guard reads the `src/` tree at runtime; under heavy
parallel load it appears to transiently misread, like the already-noted
`fresh-worktree-gate-test-gatesandboxcount-flaky-under-parallel-load`. Likely a
test-isolation/ordering flake, not a real violation (the rename added only
doc-comment prose + value-enum strings, no new `work/<folder>` path literals).
Out of scope for the config-key rename; captured for whoever hardens the suite.

## Applied answers 2026-07-07

### q1: What becomes of this signal: keep it as a watch-item, promote it to a serialise/isolate test-hardening slice, or drop it?

Keep as a watch-item. This matches the repo's settled recurrence-based bar (KEEP on first sighting; promote a serialise/isolate slice only on recurrence) and this single first sighting has no identified race mechanism (the test reads a fixed SRC_DIR with no shared mutable state), so it is below the promotion threshold and weaker even than its cited sibling. Do not promote a slice now. If it flakes again under parallel load, promote a test-hardening slice then, and capture whether a clean `pnpm -r build` preceded the failing run (a mid-edit stale-build cause is at least as plausible as a true race).
