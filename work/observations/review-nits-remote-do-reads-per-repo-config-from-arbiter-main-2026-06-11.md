---
title: review-gate non-blocking nits for 'remote-do-reads-per-repo-config-from-arbiter-main' (Gate 2 approve)
date: 2026-06-11
status: open
slug: remote-do-reads-per-repo-config-from-arbiter-main
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'remote-do-reads-per-repo-config-from-arbiter-main' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The slice explicitly required a '## Decisions' block justifying the chosen read-point (mirror-before-worktree vs job-worktree-after) and recording any in-scope design choices, but the PR has no description — only a bare 'claim:' commit. Ratify the agent's choices: (1) read-point #1, `git show main:.agent-runner.json` against the bare mirror up front, keeping the CLI's up-front harness/gate wiring intact (matches the slice's stated preference — looks correct); (2) the BOOTSTRAP two-pass resolution — resolve global+flags first solely to obtain the host-only `workspacesDir`/`identity` needed to reach the arbiter, then re-resolve with the per-repo layer on top; (3) the RESILIENT fallback — a genuine fetch/read fault (offline arbiter, corrupt mirror) WARNS and proceeds with global+default rather than failing the build. All three are sound and reversible, but none was recorded for the human to ratify.
  (cli.ts `resolveRemoteRepoConfig` + the `flags.remote !== undefined` branch (bootstrap = resolveGlobalConfig(global, remoteFlags); then resolveRemoteRepoConfig({workspacesDir: bootstrap.workspacesDir, identity: bootstrap.identity, …})); the try/catch fallback in `resolveRemoteRepoConfig`. Slice's 'Two viable read points (pick the cleaner; justify in a `## Decisions` block)'.)
- The CLI orchestrator `resolveRemoteRepoConfig` is not covered by a test that invokes it directly — including its bootstrap-then-relayer wiring and, more importantly, its warn-and-proceed fallback on a fetch/read fault. The new test file exercises the three primitives (`readRepoConfigFromMirrorMain`, `loadRepoConfigFromContent`, `resolveRepoConfigFromLoaded`) by RECONSTRUCTING the same composition inline in a local `resolve()` helper, which validates the building blocks and the precedence chain well, but means the actual function the CLI calls — and specifically the catch branch (offline arbiter → warning + global+default, the behaviour that makes a `--remote` build resilient) — has no regression test. Worth a follow-up test asserting a fault degrades gracefully rather than throwing.
  (test/remote-do-per-repo-config.test.ts reconstructs the composition; `grep resolveRemoteRepoConfig test/` finds only the file-header comment, no call. The catch block in cli.ts `resolveRemoteRepoConfig` (note(...) + loaded = {config:{}, rejected:[]}) is untested.)
