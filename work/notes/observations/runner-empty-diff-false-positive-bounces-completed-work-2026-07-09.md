---
title: The advance runner's "empty diff vs arbiter main" no-op detection FALSE-POSITIVES and bounces COMPLETED, correct work to stuck
type: observation
status: spotted
spotted: 2026-07-09
needsAnswers: true
---

## What was seen

On the 2026-07-09 lifecycle run, the propose leg for task `extend-surface-state-as-questions-brief-and-fix-dangling-idea-path` ran, the build agent did COMPLETE and CORRECT work (edited the idea-file with the 4 required additions + fixed the two dangling `work/ideas/` path references), and reported verbatim "All green: `pnpm -r build && pnpm -r test && pnpm format:check` all pass (2897 tests)". Yet the runner then bounced it:

```
>> Bounced '<slug>' to stuck (lock): the agent produced no source change building '<slug>'
   (empty diff vs the arbiter main); treating as a no-op/stop — re-scope or re-claim.
```

The runner's verdict CONTRADICTS reality. Verified after the fact against the pushed work branch `work/task-<slug>` (commit `cf05fcbf`, titled `chore(...): save aborted work (wip)`):

- `git diff --stat origin/main...origin/work/task-<slug>` = **78 insertions across 2 files** (NOT empty): +76 lines to `work/notes/ideas/advance-surfaces-and-self-clears-stuck-locks-via-questions.md` and the 2 path-ref fixes in `work/tasks/done/cutover-needs-attention-becomes-lock-stuck-recovery-surface.md`.
- The work satisfies every acceptance criterion. It was salvaged and landed by hand on 2026-07-09 (this note's sibling commit) after the false bounce.

So the runner (a) computed a WRONG "empty diff", (b) saved the real work as `save aborted work (wip)` on the branch, (c) marked the item stuck, and (d) skipped the ready->done move — wasting a full (paid) agent run on already-correct work and requiring manual recovery.

## Why it matters

This is a runner-level correctness bug, not a task/agent problem: the agent did exactly what was asked and passed its own gate, but the runner's empty-diff no-op guard rejected it. Cost: a wasted agent run + a stranded branch + a stuck lock + manual salvage, and it will RECUR for any task whose only output is a diff the guard mis-measures. It also erodes trust in the "empty diff => no-op/stop" signal, which is otherwise a legitimate backstop for a genuinely-idle agent.

Note the WIP commit title (`save aborted work (wip)`) shows the runner DID capture the change onto the branch — so the diff existed at push time; the false-negative is specifically in whatever comparison the runner uses to decide "empty diff vs arbiter main".

## Suspected mechanism (to verify when triaged)

The empty-diff / no-op detection compared the WRONG pair of refs, or measured at the WRONG moment. Candidates to check in the advance/do integration path (the "the agent produced no source change ... empty diff vs the arbiter main" branch):
- Diffing the working tree AFTER the runner already committed the agent's changes to the branch (so `git diff` vs HEAD is empty even though the branch is ahead of main) — i.e. it should compare the BRANCH TIP vs the merge-base/arbiter main, not the worktree vs HEAD.
- Diffing against a STALE local `main` ref that already contained (or was confused with) the branch.
- Only counting changes under a specific path (e.g. `packages/`/`src/`) and treating a docs-only (`work/notes/`, `work/tasks/`) change as "no source change" — the message says "no SOURCE change", so the guard may be scoped to code and mis-firing on a legitimately docs-only task.

The last candidate is the most likely given the wording ("no SOURCE change") and that this task is DOCS-ONLY (idea-file + path refs, no `packages/` edit). If the no-op guard only looks for a code diff, every docs-only task (transcribe-a-Decisions-block, fix-a-path, extend-a-brief) will be falsely bounced.

## Refs

- The bounced leg's log (2026-07-09 lifecycle run).
- The salvaged work: this note's sibling commit landing `work/tasks/done/extend-surface-state-as-questions-brief-and-fix-dangling-idea-path.md` + the idea-file + path fixes.
- The empty-diff/no-op guard in the advance/do integration path (grep the "empty diff vs the arbiter main" / "no source change" message to find the exact site).

## Note on scope

A genuine runner correctness bug with a concrete, reproducible repro (a docs-only task). The fix is to make the no-op guard measure BRANCH-vs-arbiter-main (not worktree-vs-HEAD) AND count ANY tracked change (not only code/`src` paths), so a legitimate docs-only completion is never mis-classified as an idle no-op. A human decides whether to promote a task now or gather a second instance first — but the repro here is already precise.
