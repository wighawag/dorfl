---
title: A "continue from kept branch" rebase conflict pushes users toward the destructive `requeue --reset` — there is no smooth non-destructive way to disentangle, and --reset can DISCARD correct, building work for a conflict that wasn't a genuine content clash
date: 2026-06-15
status: open
severity: high
needsAnswers: true
---

> **Restoration note (2026-07-07):** the advance workflow that scaffolded the
> task `default-requeue-succeeds-when-no-work-branch-exists` deleted this
> observation as part of consuming it. Only point 3 of the STILL-LIVE residue
> was actually in scope for that task; points 1-2 are a separate design item
> (see the task's "Out of scope" section) and MUST continue to be visible.
> Restoring the note here with point 3 marked RESOLVED-BY that task and points
> 1-2 preserved verbatim as the residue.

## The signal

When `do --isolated` continues a requeued slice and the kept `work/<slug>` branch does not rebase cleanly onto the latest main, the runner routes to needs-attention with:

```
continuing the kept work/slice-…: rebase onto the latest main conflicted
(aborted, never auto-resolved) — resolve against the latest main, or
`requeue --reset` to discard and start fresh
```

The only two options the message offers are:
1. **"resolve against the latest main"** — but there is no command/affordance that DOES this for an isolated/mirror-side branch. The branch lives on the arbiter + mirror, not in the user's checkout, so "go resolve it" has no obvious, supported path (you'd have to hand-fetch the branch, rebase, force-push — exactly the manual git the conductor is told NOT to do).
2. **`requeue --reset`** — DISCARD the work and start fresh. This is destructive (deletes the remote branch) and, as observed, did NOT even fix the situation (stale mirror ref resurrected it — see `requeue-reset-does-not-prune-hub-mirror-stale-branch-ref.md`).

So the practical pressure is to reach for the destructive option, and in this case that meant throwing away CORRECT, already-built work (the diff matched every acceptance criterion; the commit `58bf7d5` "…add to RACE_SENSITIVE; done" was sound). It felt like a shame to lose it — because it WAS a shame, and unnecessary.

## Why it matters

- The conflict here was NOT a genuine content clash between two real lines of development. It was the slice `.md` lifecycle move (needs-attention ↔ backlog ↔ done) plus accumulated appended `-m` handoff notes, conflicting because of dorfl's own incomplete mirror state. A trivial, mechanical conflict in protocol bookkeeping should be AUTO-RESOLVABLE (the runner owns both sides of a `.md` lifecycle move), not a wall that forces discarding the code.
- Routing CORRECT work to needs-attention and then nudging the user to `--reset` it inverts the protocol's intent: needs-attention is for genuine blocks, and the kept-branch-continue feature exists precisely to PRESERVE good work across requeues. A bookkeeping rebase conflict defeats both.

## What SHOULD happen

1. **Auto-resolve protocol-mechanical conflicts.** When the only rebase conflict is in `work/**` lifecycle bookkeeping (a slice `.md` folder move and/or appended handoff notes the runner itself wrote), the runner should resolve it deterministically (the arbiter's current folder is the truth for placement; appended notes union cleanly) and continue — never surface it as a human block.
2. **A non-destructive recovery verb.** Offer `requeue --reconcile`/`--rebase` (or make plain `requeue` retry the rebase after re-syncing the mirror to the arbiter) so the DEFAULT escape from a continue-conflict KEEPS the work. Reserve `--reset` for genuinely worthless branches, and make the error message lead with the non-destructive option, not `--reset`.
3. **Make "resolve against latest main" actionable.** If a real content conflict exists, give a supported command to fetch the kept branch into a scratch worktree, rebase, and re-push (the runner already owns mirror/worktree machinery), instead of telling the user to do raw git on a branch the skill forbids them to touch in the human checkout.

## The broader principle (user's framing)

Recovery affordances should be NON-DESTRUCTIVE by default and should fire on GENUINE errors. Today the path of least resistance out of a self-inflicted, mechanical conflict is to destroy correct work — and even that didn't work. The lesson: keep+continue is the right default; --reset should be rare, loud, and effective; and protocol-bookkeeping conflicts should never reach the user at all.

## Addendum (also observed live): default requeue REFUSES when no branch exists, forcing --reset even when there is nothing to lose

A second nudge toward `--reset` from the SAME run: once the branch was already gone (deleted by a prior `--reset`), the slice sat in `needs-attention/`. Running the DEFAULT `requeue` (keep+continue) to move it back to backlog failed with:

```
the work branch work/slice-… isn't on origin (the continue branch a cross-machine worker would resume from) — push it first, or `requeue --reset` to discard and start fresh. Item left in needs-attention (no backlog move).
```

So to do the harmless thing (move a needs-attention slice with NO branch back to backlog for a fresh build) the user is again told to use `--reset` — the guarded, destructive verb — even though there is literally nothing to discard. The default requeue conflates "move the .md back to backlog" with "continue from a branch", and refuses the move when the (optional) branch is absent. A needs-attention slice with no work branch should requeue to backlog WITHOUT requiring the destructive flag (keep+continue and start-fresh are identical when there is no branch). This further entrenches `--reset` as the path of least resistance.

## Update (2026-06-20, triage)

Re-investigated against current `main`. The HEADLINE ask (point 1 above: auto-resolve
protocol-mechanical / bookkeeping conflicts) is now STRUCTURALLY DISSOLVED, but the
recovery-ergonomics residue (points 2-3 + the addendum) is STILL LIVE. Narrowing the
note to that residue.

RESOLVED (delete from this note's scope):
- The self-conflict / bookkeeping-rebase class is gone at the SOURCE. The per-item-lock
  cutover (spec `ledger-status-per-item-lock-refs`) means NO transient status lands on
  `main` (claim/needs-attention/slicing/advancing are lock-ref state, not folder moves),
  so a continue rebase (`rebaseContinuedBranchOntoMain`, `continue-branch.ts`) is now a
  PLAIN rebase with NO runner-authored move-only commit to self-conflict on (the old
  `drop-bookkeeping-rebase` machinery was DELETED). Task
  `continue-rebase-auto-resolves-protocol-bookkeeping-conflicts` is in `tasks/done/`.
  So a single agent no longer hits a human-surfacing rebase conflict from dorfl's
  OWN bookkeeping of its slug; only GENUINE content conflicts surface, which was the
  whole point. The specific run in "What was seen" (a `.md`-lifecycle-move self-conflict)
  can no longer occur.

STILL LIVE (this note's remaining, narrowed scope):
1. NO non-destructive recovery verb. There is still no `requeue --reconcile` /
   `requeue --rebase` (verified: no such flag in `cli.ts`). On a GENUINE content conflict
   the only offered escape is still keep+continue (which re-hits the conflict) or the
   destructive `requeue --reset`. The DEFAULT escape from a real continue-conflict should
   KEEP the work (re-sync the mirror + retry the rebase), reserving `--reset` for
   genuinely worthless branches, and the message should lead with the non-destructive
   option.
2. "Resolve against latest main" is still not ACTIONABLE for an isolated/mirror-side
   branch (no supported command fetches the kept branch into a scratch worktree, rebases,
   and re-pushes; the human is told to do raw git on a branch the skill forbids touching).
3. ~~THE HIGH-SEV ADDENDUM (default requeue REFUSES when no branch exists): not confirmed
   fixed. The requeue help (`cli.ts`) still describes only keep+continue / `--reset`, and
   `do.ts` still emits "`requeue --reset` to discard" nudges. A needs-attention item with
   NO work branch should requeue to backlog WITHOUT the destructive flag (keep+continue
   and start-fresh are identical when there is no branch to lose).~~ **RESOLVED-BY**
   task `default-requeue-succeeds-when-no-work-branch-exists` (2026-07-07): default
   requeue now degrades to a fresh-claim move when `<arbiter>/work/<slug>` is absent
   (softened guard in `packages/dorfl/src/needs-attention.ts`, no new flag), while the
   guard is preserved for the real anomaly (branch EXISTS but is not ahead of main).

Disposition: kept as a LIVE recovery-ergonomics signal narrowed to points 1-2 above (the
addendum, point 3, is now discharged). The bookkeeping-conflict half is discharged
(structurally dissolved); points 1-2 remain a distinct, unbuilt UX/affordance concern.
`needsAnswers` stands (whether to add a non-destructive `requeue --reconcile`/`--rebase`
verb, and how to make "resolve against latest main" actionable for a mirror-side branch,
is a design call).

## Cross-refs

- `requeue-reset-does-not-prune-hub-mirror-stale-branch-ref.md` — the stale-mirror root cause that made the conflict recur and made `--reset` ineffective.
- `do-should-fail-fast-when-prepare-or-verify-unset.md` — the first self-inflicted needs-attention in the same slice (env-config gap surfaced as a build failure).
