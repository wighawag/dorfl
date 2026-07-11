## Context

From observation `rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset` (see its 2026-06-20 triage Update and its Addendum). This task carves off the SMALL, well-scoped point-3 fix; the other two live points (a non-destructive `requeue --reconcile`/`--rebase` verb, and making "resolve against latest main" actionable for a mirror-side branch) are a SEPARATE design item to be filed on its own if the broader affordance is wanted — do NOT expand scope to cover them here.

Today, if a needs-attention slice has NO work branch on the arbiter (e.g. a prior `--reset` already deleted it, or it was never pushed), the DEFAULT `requeue` (keep+continue) refuses with:

```
the work branch work/<slug> isn't on <arbiter> (the continue branch a cross-machine
worker would resume from) — push it first, or `requeue --reset` to discard and start
fresh. Item left stuck (lock not released).
```

The live guard lives in `packages/dorfl/src/needs-attention.ts` (~line 549 in the `if (!options.reset)` block that calls `branchAheadOf(cwd, \`${arbiter}/${branch}\`, \`${arbiter}/main\`, env)` and returns a `moved:false` when `onArbiter` is false). This nudges users toward the DESTRUCTIVE `--reset` verb to do a harmless thing — move a branch-less `.md` from needs-attention back to backlog — even though there is literally nothing to discard: keep+continue and start-fresh are IDENTICAL when there is no work branch to lose.

This inverts the protocol's intent (needs-attention exists for genuine blocks; `--reset` should be rare, loud, and reserved for genuinely worthless branches) and entrenches `--reset` as the path of least resistance.

## What to change

In the default (non-`--reset`) requeue path in `packages/dorfl/src/needs-attention.ts`, when the requeue-safety guard finds that `<arbiter>/work/<slug>` does NOT exist / is NOT ahead of `<arbiter>/main`, do NOT abort. Instead:

- Treat "no arbiter work branch" as equivalent to `--reset` FOR THE PURPOSE OF the safety guard only (there is no continue-branch for a future worker to resume from, so the guard's precondition is vacuously satisfied — nothing to protect).
- Proceed with the normal keep+continue backlog move (release the lock, append the `-m` handoff note if any, land the body in backlog). Do NOT delete anything on the arbiter (there is nothing to delete) and do NOT force the caller to pass `--reset`.
- Emit a short, non-alarming `note(...)` explaining what happened (something like: `"'${slug}' has no work branch on ${arbiter} — requeueing to backlog for a FRESH claim (nothing to continue from; no --reset needed)."`) so the transition is legible in the log.
- The `--reset` explicit path is unchanged: `--reset` still deletes the arbiter branch (or tolerates "already gone"), and its distinct meaning ("I am asserting the branch is worthless") is preserved. The change is purely: default requeue no longer REFUSES on a missing branch — it degrades to the same effective outcome as `--reset` when there is nothing to lose.

Do NOT weaken the guard when the branch DOES exist but is not ahead of main (that is a real anomaly and should still surface as today), and do NOT touch the local-first / arbiter-second delete ordering on the `--reset` path.

## Acceptance criteria

1. A vitest in `packages/dorfl/` covering the default-requeue path against a fixture arbiter where `refs/heads/work/<slug>` does NOT exist on the arbiter: `requeue` (no `--reset`) SUCCEEDS, the item moves from `needs-attention/` back to `backlog/` (per the current per-item-lock state model), the per-item lock is released, and the returned result is `{moved: true, ...}` — no `reasonNotMoved` about "push it first, or `requeue --reset`".
2. A vitest covering the still-guarded case: arbiter branch EXISTS but is NOT ahead of `<arbiter>/main`. Default `requeue` still refuses with the existing error (the guard is preserved for its real purpose — protecting a real branch that a worker would resume from).
3. A vitest covering the `--reset` path when the branch is already gone: unchanged behaviour (tolerates "remote ref does not exist", proceeds with the requeue). No regression.
4. The `requeue` CLI help text in `packages/dorfl/src/cli.ts` is updated to reflect that default `requeue` handles the no-branch case gracefully (a single-sentence tweak; do NOT invent new flags or new verbs — those belong to the separate design item).
5. The observation file `work/notes/observations/rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset.md` is updated in its "STILL LIVE" list to strike through / mark point 3 (the addendum) as RESOLVED-BY this task, leaving points 1-2 as the residue. Do not delete the observation.
6. `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Out of scope (explicitly, so the task stays small)

- Adding a `requeue --reconcile` / `requeue --rebase` verb (points 1-2 of the observation's residue). That is a SEPARATE design item — file it on its own if wanted; do NOT bundle it here.
- Making "resolve against latest main" actionable via a supported fetch-scratch-worktree-rebase-repush command. Same separate design item.
- Any change to `--reset`'s stale-mirror pruning behaviour (that lives in `requeue-reset-does-not-prune-hub-mirror-stale-branch-ref` and is cross-referenced there).

## References

- `work/notes/observations/rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset.md` (this task's source; specifically the Addendum and STILL-LIVE point 3).
- `packages/dorfl/src/needs-attention.ts` — the guard to soften (the `if (!options.reset)` / `branchAheadOf` block).
- `packages/dorfl/src/cli.ts` — `requeue` help text.
- `work/notes/observations/requeue-reset-does-not-prune-hub-mirror-stale-branch-ref.md` — related, but a distinct concern; do NOT try to fix here.

## Prompt

> Build the task 'default-requeue-succeeds-when-no-work-branch-exists', described above.
