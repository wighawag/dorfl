# 2026-06-06 — `run`'s agent-failure path does NOT save+push work (the `do.ts` fix was not mirrored to `run.ts`)

Noticed while extending `gate-fail-pushes-work-branch` to `run`'s integrate-time
rebase-conflict path.

`agent-fail-saves-work` (PR #8) fixed **`do.ts`**: a non-zero agent exit now routes
through `saveAgentFailure` (commit + push the `work/<slug>` branch + surface on the
arbiter's main), so partial work is cross-machine recoverable via requeue-continue.

But **`run.ts` was NOT touched** by that slice. Its agent-failure return points
(`src/run.ts`, the `agent-failed` returns after prompt-assembly / `runAgent` throw /
`agent.ok === false`) still **bare-return** `{status: 'agent-failed'}` — no commit,
no push, no needs-attention surfacing. So on the autonomous **fleet** path (`run`),
a failed agent's partial work is left only on the LOCAL work branch in the
(disposable) job worktree:

- the worktree is RETAINED (the §4 predicate keeps it — the branch is not on the
  arbiter), so the work is not *destroyed*, BUT
- it is NOT on the arbiter, so a requeue-continue on a DIFFERENT machine (or after a
  `gc` reap) finds no `<arbiter>/work/<slug>` ahead of main and re-cuts fresh —
  orphaning the work. Same cross-machine loss the gate-fail / agent-fail (`do`)
  fixes close, but for `run`'s agent-fail path.

This is the LAST instance of the recurring root cause: **the needs-attention seam
surfaces the LEDGER on main but never pushes the work branch; every autonomous
bounce must push it explicitly.** After `agent-fail-saves-work` (PR #8) +
`gate-fail-pushes-work-branch` (PR #9), the paths that push are: `do` agent-fail,
`do`/`complete` gate-fail + rebase-conflict, `run` gate-fail, `run` integrate-time
rebase-conflict. The remaining NON-pushing autonomous bounce is **`run`'s
agent-failure** (and the §14 `run` continue-rebase-conflict, which is intentionally
retained because its branch is already on the arbiter from the prior requeue).

Note (test coupling): `run.test.ts`'s "an agent-failed pi job retains the pi harness
record" test currently RELIES on this gap (agent-fail retains the worktree so the
record is readable after teardown). When this gap is fixed (run-agent-fail also
saves+pushes ⇒ reaped), that test must move to another retained path (the §14
continue-rebase-conflict path).

Fix shape (a follow-up slice — mirror `do.ts`'s `saveAgentFailure` in `run.ts`):
route `run`'s agent-failure through the same seam transition + `pushWorkBranch`, so
the fleet's failed-agent work is cross-machine recoverable too. Small, bounded, and
makes the "every autonomous bounce pushes the branch" rule finally uniform.
