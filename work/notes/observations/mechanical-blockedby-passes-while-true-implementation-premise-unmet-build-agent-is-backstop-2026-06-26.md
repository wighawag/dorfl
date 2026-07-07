---
title: A task's mechanical `blockedBy` can be satisfied while its TRUE implementation premise is unmet; the build agent's code-read is the backstop that catches it (apply-rung-merge-disposition CI stop)
date: 2026-06-26
status: open
needsAnswers: true
---

## What was seen

A scheduled `advance-lifecycle` CI run (GitHub Actions run 28256817530, job
83721973110) enumerated and dispatched `task:apply-rung-merge-disposition`, the
build agent STOPPED with a `TASK-STOP`, and the runner bounced the per-item lock
to `stuck`. At first glance this looked like a dependency-gating BUG (a blocked
task should never have been claimed). After full triage it is NOT a dispatch /
eligibility / mirror bug. It is the dependency-graph backstop working as
designed, plus one genuinely misleading log message (captured + fixed
separately, see the `## Spawned` section).

## The evidence trail (so a future reader does not re-derive it)

The decisive fact is in the job's `actions/checkout@v4` step: it checked out
**`14d0d239...`** (a force-update of `origin/main` for that run), NOT the tip I
kept re-reading locally. The repo had moved on since.

At `14d0d239` (Jun 26 17:17) the task state was:

- folder: `work/tasks/ready/` (the agent pool), `needsAnswers: false`, NO sidecar;
- `blockedBy: [merge-question-surfacer, sidecar-kind-field]` (only TWO blockers);
- BOTH of those two blockers were in `work/tasks/done/`.

So `blockedBy.satisfied == true`: the task was **mechanically eligible** and the
enumerator (`scan --json | jq 'select(.eligibility.eligible == true)'`) was
RIGHT to emit it. Eligibility/scan/jq all behaved correctly.

The build agent then READ THE CODE (`integration-core.ts`
`recoverAlreadyCommitted` near line 1582) and discovered the task's real
implementation premise needed a fresh-worktree-gate-honouring committed-recovery
tail that **did not exist as a task yet**. It stopped rather than produce
wrong-but-compiling work. That stop is what DROVE the human re-scope: commit
`0122fdd` (Jun 26 19:16) re-scoped the task, added two NEW blockers
(`committed-recovery-honours-fresh-worktree-gate`, `strict-merge-approval-gate`)
that did not previously exist, and moved the body's premise to the new model.
The 4-blocker frontmatter + the `TASK-STOP` prose are the RESULT of this run,
committed afterwards (which is exactly why reading current HEAD looked
contradictory: current HEAD correctly reports `eligible:false`, because the
re-scope added two not-yet-done blockers).

## Why it matters (the real signal)

`blockedBy` is a PRE-BUILD gate resolved purely against `work/done/`
membership. It encodes the dependencies SOMEONE DECLARED at tasking/promote
time. It can be fully satisfied while the task's ACTUAL build premise depends on
work that was never expressed as a blocker (here: a sibling task that did not
even exist yet). In that gap:

- the mechanical gate passes,
- the item is correctly enumerated + dispatched,
- and the ONLY thing that catches the unmet premise is the build agent reading
  the code at build time and issuing a `TASK-STOP`.

That backstop works, but it is the EXPENSIVE layer (a full agent dispatch + a
`stuck` lock + a human re-scope) doing what a cheaper layer might have caught.
The cost each time is: one spawned session, one bounced-to-stuck lock, and a
required human intervention to re-scope.

## NOT the cause (theories ruled out during triage, recorded so they are not re-chased)

- NOT a stale registry mirror: `advance-lifecycle` CI runs from a fresh
  `actions/checkout` of `main`; there is no `workspacesDir` of hub mirrors in the
  runner, so the `.repos[]` (mirror) scan arm is empty in CI.
- NOT the always-on apply pool / a `needsAnswers:true` + answered-sidecar rerun
  loop: this task was `needsAnswers:false` with NO sidecar at the run commit, so
  it never entered surface/apply. (The apply-pool rerun-loop concern remains a
  valid FORWARD-LOOKING design rule for the future `kind: merge` deterministic
  apply path: that path must reach a terminal state on a failed land and never
  leave answered-sidecar + `needsAnswers:true` intact, or the always-on apply
  pool re-fires it every tick. It did NOT cause this incident.)
- NOT an explicit-name claim bypassing eligibility: the leg came from the
  enumerate matrix on a state where the item was genuinely eligible, not from a
  hand-named force-claim.

## Possible directions (not committed; for a future task/ADR if judged worth it)

- Surface "premise" dependencies (the ones a builder will discover by reading
  code) at PROMOTE/REVIEW time rather than at build time, so the `blockedBy`
  graph is complete before the task enters the pool. The review/promote skills
  already inspect the dependency graph; this would push the check earlier.
- Make a premise-unmet `TASK-STOP` cheaper to recover than a full `stuck` bounce
  (e.g. route "blocked-by-undeclared-premise" stops to a re-scope queue rather
  than needs-attention), so the backstop costs less when it fires.

## Spawned

- FIX (made same session): the claim success message in `claim-cas.ts`
  hard-coded `body stays in work/backlog/` for ANY claim, even a `tasks/ready/`
  pool claim. That false "backlog" wording actively misled this triage for
  several rounds (it made a `ready/` pool item look like a staging claim). The
  message now reports the RESOLVED residence (`tasks/ready/` normally,
  `tasks/backlog/` under `--allow-backlog`). Test:
  `claim-acquires-unified-lock.test.ts` ("the success message names the REAL
  residence").
