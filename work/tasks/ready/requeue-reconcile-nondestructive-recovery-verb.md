---
promotedFrom: observation:rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset
---

## Context

This task discharges point 1 (the non-destructive recovery verb) of the LIVE residue in
observation `rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset`.
Point 2 of that residue ("make 'resolve against latest main' actionable for an
isolated/mirror-side branch via a supported command that fetches the kept branch into a
scratch worktree, rebases, and re-pushes") is EXPLICITLY DEFERRED as a larger design
follow-on and is out of scope here — leave the observation on record so that piece stays
visible.

Today, when `do --isolated` continues a kept `work/<slug>` branch and the rebase onto
the latest main conflicts on GENUINE content (the bookkeeping-conflict class is already
structurally dissolved by the per-item-lock cutover), the runner routes to
needs-attention with a message whose only two offered escapes are:

1. "resolve against the latest main" — not actionable for a mirror-side branch (deferred).
2. `requeue --reset` — DESTRUCTIVE (deletes the remote branch, discards possibly-correct
   work), and historically not even effective (stale mirror ref).

The path of least resistance is therefore to DESTROY work. That inverts the protocol's
intent: keep+continue exists precisely to PRESERVE good work across requeues, and
`--reset` should be rare/loud/last-resort.

## What to build

1. **A new non-destructive recovery verb.** Add `requeue --reconcile` (accept
   `--rebase` as an alias if cheap; pick one canonical name in the implementation and
   document the other as an alias) to `packages/dorfl/src/cli.ts` and its handler.
   Semantics:
   - Precondition: item is in `needs-attention/` AND `<arbiter>/work/<slug>` EXISTS and
     is ahead of main (i.e. there IS work to keep). If the branch is absent, fall
     through to the already-fixed default-requeue behaviour (fresh-claim move — see
     `default-requeue-succeeds-when-no-work-branch-exists`, done). If the branch exists
     but is not ahead of main, keep today's guard.
   - Action: re-sync the hub mirror to the arbiter (the same prune/re-fetch step whose
     absence caused `requeue-reset-does-not-prune-hub-mirror-stale-branch-ref`), then
     retry `rebaseContinuedBranchOntoMain` on the kept branch. On success, move the
     slice `.md` back to `backlog/` (or wherever the normal keep+continue requeue lands
     it) so the next `do` picks it up and continues from the rebased branch. On failure
     (the rebase STILL conflicts after a clean mirror re-sync — i.e. a real content
     clash), leave the item in `needs-attention/`, leave the branch untouched (NEVER
     delete it), and emit a message that:
       a) says the reconcile retried after re-syncing the mirror and the conflict is
          genuine content, and
       b) points at the deferred follow-on for a supported mirror-side resolve path
          (see "Follow-on" below), and
       c) mentions `requeue --reset` LAST, as the destructive last resort, not the
          headline.
   - NEVER touches the remote branch destructively. This verb's contract is
     "keep the work".
2. **Re-order the continue-conflict error message** emitted by the `do --isolated`
   continue path (the "continuing the kept work/slice-…: rebase onto the latest main
   conflicted" message; search `packages/dorfl/src/do.ts` and the continue-branch code
   for the current text) so it LEADS with the non-destructive option (`requeue
   --reconcile`) and only mentions `requeue --reset` LAST, framed as destructive. Same
   re-ordering for any other place that currently nudges the user toward `--reset` out
   of a continue-conflict.
3. **Update `requeue` help text** in `cli.ts` to describe the three modes in the
   correct escalation order: default keep+continue → `--reconcile` (non-destructive
   recovery: re-sync mirror + retry rebase, keep the work) → `--reset` (destructive:
   discard the branch and start fresh, last resort).
4. **Tests** in `packages/dorfl/` covering:
   - `requeue --reconcile` on a needs-attention slice whose kept branch rebases cleanly
     after a mirror re-sync: item returns to backlog, branch preserved, no destructive
     side effects.
   - `requeue --reconcile` on a needs-attention slice whose kept branch STILL conflicts
     on genuine content after re-sync: item stays in needs-attention, branch untouched,
     message leads with the deferred follow-on hint and mentions `--reset` only as last
     resort.
   - The continue-conflict message from `do --isolated` leads with `--reconcile` and
     mentions `--reset` last (string assertion on ordering is fine).
   - Regression: `requeue` (default, no flag) on a needs-attention slice with NO branch
     still succeeds as a fresh-claim move (don't regress
     `default-requeue-succeeds-when-no-work-branch-exists`).
5. **Acceptance gate**: `pnpm format` then `pnpm -r build && pnpm -r test &&
   pnpm format:check` all green (per AGENTS.md).

## Out of scope / Follow-on

- **DEFERRED** (do NOT build here): a supported command that makes "resolve against
  latest main" actionable for an isolated/mirror-side branch (fetch kept branch into a
  scratch worktree, rebase, re-push) instead of telling the user to do raw git on a
  branch the skill forbids touching. This is a larger design piece involving
  worktree/mirror machinery choices; keep it visible on the parent observation
  (`rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset`, point 2 of
  the LIVE residue). The `--reconcile`-failure message should REFERENCE that future
  affordance rather than pretend it exists.
- Do not redesign the bookkeeping-conflict path — it is already structurally dissolved
  by the per-item-lock cutover.

## Prompt

> You are building the task
> `requeue-reconcile-nondestructive-recovery-verb`. Read this task file in full,
> plus the parent observation
> `work/observations/rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset.md`
> for the WHY. Then read `packages/dorfl/src/cli.ts`, `packages/dorfl/src/do.ts`,
> `packages/dorfl/src/needs-attention.ts`, and the continue-branch code
> (`rebaseContinuedBranchOntoMain` / `continue-branch.ts`) to see the CURRENT
> requeue verbs, guards, mirror-sync helpers, and the continue-conflict error message
> you will be re-ordering.
>
> Deliver, in one coherent change:
>
> 1. A new non-destructive `requeue --reconcile` verb (accept `--rebase` as an alias if
>    cheap) that, when the item is in `needs-attention/` and `<arbiter>/work/<slug>`
>    exists and is ahead of main, re-syncs the hub mirror to the arbiter and retries
>    the rebase onto latest main. On success: move the slice `.md` back to backlog so
>    the next `do` continues from the rebased branch. On failure (genuine content
>    conflict after a clean mirror re-sync): leave the item in needs-attention, leave
>    the branch untouched, and emit a message that explains the retry happened,
>    references the deferred follow-on for a supported mirror-side resolve path, and
>    mentions `requeue --reset` LAST as the destructive last resort. NEVER delete the
>    remote branch from this verb. If the branch is absent, fall through to the
>    existing default-requeue fresh-claim behaviour; if the branch exists but is not
>    ahead of main, keep today's guard.
> 2. Re-order the continue-conflict error message emitted from the `do --isolated`
>    continue path so it LEADS with `requeue --reconcile` (non-destructive: re-sync
>    mirror + retry rebase, keep the work) and only mentions `requeue --reset` LAST,
>    framed as destructive. Apply the same re-ordering to any other message that
>    currently nudges toward `--reset` out of a continue-conflict.
> 3. Update the `requeue` help text in `cli.ts` to describe the escalation order:
>    default keep+continue → `--reconcile` (non-destructive recovery) → `--reset`
>    (destructive last resort).
> 4. Add tests in `packages/dorfl/` covering: (a) `--reconcile` succeeds after a
>    mirror re-sync (item returns to backlog, branch preserved); (b) `--reconcile`
>    fails on genuine content conflict (item stays in needs-attention, branch
>    untouched, message ordering asserted); (c) the continue-conflict message leads
>    with `--reconcile` and mentions `--reset` last; (d) regression: default
>    `requeue` with no branch still succeeds as a fresh-claim move.
>
> Out of scope: do NOT build the mirror-side "resolve against latest main" command
> (fetch kept branch into scratch worktree, rebase, re-push). That is DEFERRED as a
> follow-on; the parent observation retains point 2 of its LIVE residue for it. Your
> `--reconcile`-failure message should REFERENCE that future affordance rather than
> pretend it exists.
>
> Do not perform git operations on this repo (no stage/commit/push, do not move slice
> files between `work/` folders). The runner owns every git-state transition. Your
> tests MAY use throwaway git repos.
>
> Acceptance gate: run `pnpm format`, then confirm `pnpm -r build && pnpm -r test &&
> pnpm format:check` all green.
