---
title: 'A continue rebase resolves a conflict confined to question sidecars mechanically; it is a narrow exception to never-auto-resolve, not the mirror-side resolve verb'
status: accepted
created: 2026-10-30
decided: 2026-10-30
supersedes:
superseded_by:
---

# ADR: a continue rebase resolves question-sidecar conflicts mechanically

## Context

A task's question sidecar (`work/questions/task-<slug>.md`) is written by two runner paths and by nobody else (apart from a human answering it):

- the **surface** writes or rewrites it on `main` when an attempt bounces (a red gate, a conflict, a timeout);
- the **land** deletes it in the completion commit that done-moves the task (`clearOwnQuestionResidueOnLand`, task `a-recovered-task-lands-without-stale-question-state`), so the question leaves `main` in the same commit that makes it moot.

On a kept branch those two writes collide. Seen live on dorfl 0.15.1 (wherever task `assistant-folder-opt-in-and-lock`):

1. The first gate fails; the surface writes the sidecar on `main`.
2. `requeue --reconcile` + `do` continues. The land clears the stale question state, which deletes the sidecar in the branch's completion commit. The gate fails again, and the surface rewrites the sidecar on `main` with the new reason.
3. The next continue rebase is a modify/delete conflict on the sidecar. It was aborted and surfaced ("conflicted on work/questions/task-<slug>.md (aborted, never auto-resolved)"), and `requeue --reconcile` hit the same conflict and could only point at the unbuilt mirror-side resolve command or the destructive `--reset`.

The contract claimed "branch self-conflicts cannot occur by construction" because no transient status lands on `main`. That stopped being true once the land started deleting a file the surface writes on `main`.

## Decision

1. **`rebaseContinuedBranchOntoMain` resolves a stop whose conflicts are ALL question sidecars, then continues the rebase.** It is the one function every continue rebase goes through (the in-place `start` onboard, the job-worktree `createJob`, the `--isolated` checkout, `requeue --reconcile`'s scratch worktree, and the stale-lease push retry), so all of them get it.
2. **The rules mirror the land's own clear**, so the two never disagree about what "stale" means:
   - main's version carries a human answer (or cannot be parsed): take main's version. An answer is never discarded mechanically.
   - the branch deletes the sidecar AND its tip done-moves the item (`work/tasks/done/<slug>.md` for `task-<slug>.md`): the deletion wins. The task is done on that branch, so the question is moot, and the land would delete it anyway.
   - otherwise: take main's version. Main is the truth for protocol state the branch does not own.
3. **Everything else still aborts.** A stop that also conflicts on any non-sidecar path, a later replayed commit that conflicts on code, or a replayed commit whose own sidecar version carries an answer (something the runner did not write) aborts the whole rebase back to the untouched kept tip, exactly as before (§10 of `execution-substrate-decisions`).
4. **The resolution is reported**, on the clean result (`resolvedSidecars`) and as a note on the paths that have one (`start`, `requeue --reconcile`).

## Classification: not point 2 of the observation

Observation `rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset` listed (1) auto-resolve protocol-mechanical conflicts, (2) a mirror-side "resolve against latest main" command for genuine content conflicts, and (3) a default requeue that works without a branch. Its 2026-06-20 triage declared point 1 "structurally dissolved" by the per-item-lock cutover. This bug is point 1 coming back through a different runner-owned file, the sidecar, not point 2:

- point 2 is a human-driven verb for a conflict that needs semantic judgement. This conflict needs none; both sides are the runner's own writes, and the outcome is the one the land would produce.
- building point 2 would not have fixed this: the human would still be handed a conflict that should never have reached them.

So the fix is the narrow special case, and point 2 stays an open, unbuilt affordance for genuine content conflicts.

## Considered options

- **Resolve at the continue rebase (chosen).** One function, every continue site, the same rules as the land.
- **Do not rewrite the sidecar on a second surface when the kept branch will delete it.** Rejected: the second failure's reason is exactly what the human needs while the item is stuck, and the branch's deletion only takes effect if the branch lands. The surface would also have to read the kept branch, which it has no business doing.
- **Do not delete the sidecar on the branch; let the land clear it on `main`.** Rejected: in merge mode the land IS the branch tip (fast-forward), and in propose mode the PR is merged by the host with no runner commit afterwards, so there is no main-side land commit to carry the clear. That is the defect `a-recovered-task-lands-without-stale-question-state` fixed.
- **Clear the sidecar only after the gate passes (in the land half).** Rejected: the gated tip would differ from the landed tip, and the CI apply phase resumes from the validated agent-phase tip.

## Consequences

- The kept branch keeps its work across any number of bounce/continue cycles; `--reset` is no longer the only way out of this shape.
- `execution-substrate-decisions` §10 "never auto-resolve" keeps its meaning for content: dorfl never picks a side on anything but a question sidecar, and never discards an answer.
- The INTEGRATION rebase (`rebaseOntoMainWithReconcile`) does not apply these rules. In the observed flow it does not need to: the continue rebase already resolved the conflict, and the item is claimed during the run, so no surface can rewrite the sidecar before the land. A human answering the sidecar on `main` mid-run still routes the land to needs-attention, which is the conservative outcome for a fresh answer.
