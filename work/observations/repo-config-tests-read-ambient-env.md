# Several `resolveRepoConfig` tests read `process.env`, so an ambient `AGENT_RUNNER_*` breaks them

2026-06-05 (while building `do-threads-harness-flags`)

`test/repo-config.test.ts` has cases (e.g. "a repo with no file and a bare global
keeps the built-in defaults", `expect(resolved.config).toEqual(DEFAULT_CONFIG)`)
that call `resolveRepoConfig` WITHOUT injecting `env:`, so they fall through to
`process.env`. When the runner's shell exports an `AGENT_RUNNER_*` var
(observed live: `AGENT_RUNNER_HARNESS=pi`), the env layer leaks `harness: 'pi'`
into the resolved config and 2 such tests fail spuriously (`pnpm -r test` shows
`harness: "pi"` added to the expected default object). The suite is green in a
clean env (`env -u AGENT_RUNNER_HARNESS pnpm -r test` → 584 passed).

Out of scope for this slice (the fix would be to inject `env: {}` in those
specific assertions, as the model-config + new do-config tests already do). Not
touched here — just flagged.
