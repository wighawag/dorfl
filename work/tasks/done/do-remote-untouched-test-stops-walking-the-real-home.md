---
title: 'The do --remote 'real dirs are UNTOUCHED' test must not walk the developer's real ~/.dorfl and pi sessions'
slug: do-remote-untouched-test-stops-walking-the-real-home
blockedBy: []
---

## What to build

the `test/do-remote.test.ts` case named `the real ~/.dorfl/ and ~/.pi/agent/sessions/ are UNTOUCHED` snapshots the REAL `~/.dorfl` and `~/.pi/agent/sessions` with a full recursive walk (`listAllFiles`) before and after a run. Its cost and its outcome depend on the developer's own machine: on telemaque (about 115k files under `~/.dorfl`, mostly retained job worktrees with `node_modules`, and 3.3 GB of pi sessions) it times out at 5 s deterministically, hits `ELOOP` in pnpm symlink trees, runs the vitest worker out of heap, or fails because another session's live dorfl job changes `~/.dorfl` mid-walk. During the 2026-09-27/28 CI-split drive it bounced six unrelated tasks at the land gate and blocked the last one outright. Observations: `do-remote-untouched-dirs-test-walks-the-real-dorfl-home`, `do-remote-untouched-dirs-walk-races-concurrent-runs-2026-09-27`, and the three `do-remote-untouched-dirs-walk-bounced-*` notes.

Keep the invariant (a `do --remote` run never writes to the real state dirs) but prove it without walking the real home: for example run the command with `HOME` (and every dorfl/pi dir env lever) pointed at a scratch home and assert the scratch real-dir stand-ins are untouched while the configured scratch workspaces were used, or stat only the top-level entries the code could create, or watch for writes under the real dirs with a bounded check that never recurses into unrelated trees. Whatever the approach, the test's cost and result must not depend on what else lives in the developer's home.

## Acceptance criteria

- [ ] The invariant 'do --remote never writes to the real ~/.dorfl or pi sessions' is still asserted.
- [ ] The test does not recurse into the real `~/.dorfl` or `~/.pi/agent/sessions`; its runtime does not grow with their size (a test or a comment shows how).
- [ ] The test passes on a host where `~/.dorfl/work` holds a large retained worktree and another dorfl job is running.
- [ ] The five observation notes named above are updated or marked resolved by this task.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: make `packages/dorfl/test/do-remote.test.ts`'s "UNTOUCHED" test independent of the developer's real home directory while keeping what it proves. Read the test (`listAllFiles` and the case that uses it), the env levers dorfl and pi use for their state dirs (`workspacesDir`, `PI_CODING_AGENT_DIR`, the dorfl home resolution), and the observations listed in the task body. This test currently blocks the acceptance gate on the maintainer's machine, so land it first in any drive.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **Hermetic `HOME` instead of reading the real home.** I pointed `HOME` at a scratch home with fake state dirs and compared listings of the whole scratch home. This follows option (b) from the question on the original note. The other options were a bounded-depth listing of the real dirs, or a longer timeout. I rejected both: a longer timeout keeps the cost tied to your home, and a shallow real-root listing can still race other dorfl jobs while catching little, since leaks land under `repos/` or `work/`. The trade-off is that the test proves "every path dorfl and pi build from the home stays in scratch" rather than inspecting this machine's actual home; the `homedir()` guard keeps that from being vacuous. Only this test is affected.
- **No extra shallow check on the real dirs.** The question's suggested answer also proposed a non-recursive listing of the real dirs as a backup. I left it out because it could still be flaky while another dorfl job runs (which the acceptance criteria rule out) and would only catch writes at the top level. Only this test is affected.
- **Deleted the notes instead of appending "resolved" updates.** The work contract says a spent note leaves by deletion and has no "resolved" status. I deleted the question attached to the first note along with it, and moved its still-live point into the new observation above. The affected files are under `work/notes/observations/` and `work/questions/`.
