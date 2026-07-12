<!-- dorfl-sidecar: item=observation:flaky-fresh-gate-and-self-renaming-folder-fixture-2026-07-11 type=observation slug=flaky-fresh-gate-and-self-renaming-folder-fixture-2026-07-11 allAnswered=false -->

Item: [`observation:flaky-fresh-gate-and-self-renaming-folder-fixture-2026-07-11`](../notes/observations/flaky-fresh-gate-and-self-renaming-folder-fixture-2026-07-11.md)

## Q1

**What should become of this flaky-fresh-gate / self-renaming-folder observation — delete it (single unreproduced occurrence, no live signal), keep it open pending recurrence, or mint a task to investigate the specific 'm.oldName is not a function' + 'No projects found' failure mode?**

> work/notes/observations/flaky-fresh-gate-and-self-renaming-folder-fixture-2026-07-11.md records ONE run of pnpm --filter dorfl test that failed with TypeError: m.oldName is not a function at /tmp/dorfl-fresh-gate-*/tip/caller.js plus repeated 'No projects found in /tmp/dorfl-self-renaming-folder-*/project'; a re-run of the same suite was fully green (2956 tests) with no code change; the author flagged it as a likely subprocess/tmp race and did not investigate. The related task work/tasks/cancelled/harden-fresh-worktree-gate-sandbox-count-against-parallel-flake.md was cancelled 2026-07-12 (~28 full test runs green) and explicitly notes THIS observation is a DIFFERENT failure than the gateSandboxCount() race it targeted, and recommends: if the specific mode resurfaces, mint a fresh observation with a reproducing run rather than resurrecting the old task. Nothing has been added to the observation since 2026-07-11, and grep across packages/dorfl finds no code named oldName / caller.js on the tip path that would obviously explain the failure.

_Suggested default: Delete — single unreproduced occurrence, no live signal after the surrounding fresh-gate flake investigation went 28 runs green; if it recurs, mint a fresh observation with a reproducing run per the cancelled task's guidance._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Keep open pending recurrence. It is a single unreproduced occurrence with no live signal, so do not mint an investigation task yet, but the failure mode is specific enough ('m.oldName is not a function' + 'No projects found') that deleting it would throw away a useful fingerprint if it recurs. Revisit and promote (or delete) on the next occurrence.
