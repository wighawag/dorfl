---
title: 'Answering keep on a gate-bounce stuck question makes the continue rebase conflict: the applied answer and the kept Decisions both append to the task body'
date: 2026-09-29
status: spotted
---

Seen by the conductor of a drive-tasks run over this repository (dorfl 0.14.3, `surfaceBlockers: true`). Serious: the protocol's own "continue from the kept work" recovery deadlocks on its own writes.

Sequence, all on `task:merge-question-surfacer-finds-namespaced-work-branches`:

1. `do --isolated --allow-backlog --propose` built the task; the kept branch `work/task-<slug>` (commit 0d54d666) done-moves the body `tasks/backlog/ -> tasks/done/` and the runner appended the agent's `## Decisions` block at the end of the body.
2. The fresh-worktree gate failed on unrelated timeouts, so the bounce wrote a `kind=stuck` sidecar and `needsAnswers: true` to `main`.
3. The human answered `keep`; `dorfl advance task:<slug>` applied it (commit 1fe14f59): it cleared `needsAnswers` and appended `## Applied answers 2026-09-29` with the answer at the end of the SAME body on `main`.
4. The re-`do` continued from the kept branch and its continue rebase conflicted in `work/tasks/done/<slug>.md`: both sides added a trailing section at end of file (reproduced with a plain `git -c merge.directoryRenames=false rebase origin/main` in a scratch clone). The item bounced again (commit 2df92d06), with a fresh stuck question.

So for any agent that records Decisions (the prompt asks every agent to), `keep` after a bounce cannot succeed; only `reset` (discard the work) gets the item moving. The item body is written by both the kept branch (the done-move plus Decisions) and the apply rung on `main` (applied answers). Possible fixes: the continue rebase could resolve conflicts confined to the item's own body by taking `main`'s version and re-appending the branch's Decisions; or the bounce could strip the runner-owned done-move and Decisions from the kept branch (re-adding them at the next land), so the kept branch never touches the body `main` keeps editing; or the apply rung could record answers outside the body. Related: `gate-bounce-with-surface-blockers-leaves-a-stuck-sidecar-requeue-cannot-clear.md`.
