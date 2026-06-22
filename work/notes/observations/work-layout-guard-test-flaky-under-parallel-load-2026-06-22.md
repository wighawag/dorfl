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
