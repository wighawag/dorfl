---
title: 'pre-backlog-staging-and-promote.test.ts stops mirroring into the real ~/.dorfl (and stops flaking on teardown)'
slug: pre-backlog-test-stops-mirroring-into-the-real-dorfl-home
blockedBy: []
---

## What to build

Observation `pre-backlog-test-mirrors-into-the-real-dorfl-home-2026-09-28`: some `performTask` call in `packages/dorfl/test/pre-backlog-staging-and-promote.test.ts` resolves the DEFAULT workspaces dir (`homedir()/.dorfl`) and creates a hub mirror for its `file:///tmp/pre-backlog-step-a-*/project-work.git` arbiter under the developer's real `~/.dorfl/repos/tmp/`. Every gate run leaks another dir (476 had built up; they were deleted), each of which then makes `dorfl status` print an offline-mirror warning. The same test flaked once in CI with `ENOTEMPTY` while its teardown removed `project-work.git`, likely the same root cause (a mirror or background git still writing into the fixture).

Point every such call at the test's scratch dir (the same isolation #428 applied to the do-remote untouched-dirs test), so the real home is never touched, and make the teardown robust if something is still writing.

## Acceptance criteria

- [ ] No call in the test resolves the real home: every `performTask` (and any helper) gets an isolated workspaces dir / `HOME`.
- [ ] A test asserts the real `~/.dorfl/repos` is untouched by the suite's runs (e.g. compare its listing before/after, or run with `HOME` pointed at scratch and assert nothing appears outside it).
- [ ] The teardown no longer races (explain the cause found in Decisions; if it was the mirror, isolating it is the fix).
- [ ] The observation is marked resolved.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: make `pre-backlog-staging-and-promote.test.ts` fully hermetic. Read the observation named above, the test, the `workspacesDir` / hub-mirror resolution (`repo-mirror.ts`, `workspace.ts`), and how `do-remote-untouched-dirs` tests were isolated in the `do-remote-untouched-test-stops-walking-the-real-home` task (in `work/tasks/done/`). Find which call falls back to the real home and fix it at the test (and at the product if a caller cannot pass the dir it should).
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED). If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). The task body lives in `work/tasks/backlog/` (a deliberate drive-from-staging build).
>
> RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles. Never read or write the real `~/.dorfl`, `~/.pi` or other real home state from tests: isolate it to a scratch dir.

## Decisions

- **Cause of the teardown flake (`ENOTEMPTY` on `project-work.git`): not the mirror.** The mirrors were in the real home, never in the fixture, so isolating them could not fix it. I traced git with `GIT_TRACE2_EVENT`: after every `file://` push, `git-receive-pack` in the test arbiter started a background `git maintenance run --auto --quiet --detach`, which keeps running after the push returns. That makes it a writer the teardown can race. `gitEnv()`'s `gc.auto=0` / `maintenance.auto=false` never reached it, because git strips `GIT_CONFIG_COUNT` and the related variables before starting `receive-pack` for a local push. The fix is to set `receive.autogc=false`, `maintenance.auto=false` and `gc.auto=0` in the arbiter's own config inside `seedRepoWithArbiter`, which receive-pack does read. After the change the trace shows zero maintenance starts.
    - **Alternatives:** keep relying on `rmrf`'s retries (hides the race, doesn't remove it), or make the arbiter config change in this test only.
    - **What it touches:** every suite that seeds through `seedRepoWithArbiter`, which are all test fixtures. It likely also fixes the related `ENOTEMPTY` flake noted in `apply-answered-treeless-cleanup-enotempty-flake` (not verified).
- **Isolation is an explicit `--config` / `workspacesDir`, not only `HOME`.** Pointing `HOME` at scratch cannot redirect the fallback, because `DEFAULT_CONFIG.workspacesDir` is computed from `homedir()` once, when `config.ts` is first loaded. I confirmed this by removing `--config` with `HOME` already pointed at scratch: the mirrors still went to the real home. So `HOME` isolation is kept only as defence in depth, and the "real home untouched" check looks at `mergeConfig({}).workspacesDir`, the exact paths this test would leak to. Nothing in the product changes, because callers can already pass the directory via `--config`.
    - **Alternatives:** compare a listing of the real `~/.dorfl/repos` before and after. Another dorfl job writing there would make that flaky, as happened with the earlier do-remote test.
    - **What it touches:** this test only. The frozen default is recorded as a new observation, because it may make `do-remote.test.ts`'s `homedir()` guard weaker than it looks.
