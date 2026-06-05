---
title: recovering a good needs-attention item requires manual git — complete only accepts from in-progress/
type: observation
status: spotted
spotted: 2026-06-05
---

# No runner-owned path to re-gate-and-complete a needs-attention item whose work is actually good

## What was spotted (live, 3 dogfood runs in)

When an autonomous run (`do` / the future `run`) hits a gate failure, it routes the
item to `work/needs-attention/` and surfaces it on the arbiter (working as designed,
ADR §12). But when the gate failure was SPURIOUS (the work is actually fine \u2014 e.g.
on `do-threads-harness-flags` the gate failed only because the operator's
`AGENT_RUNNER_HARNESS=pi` env workaround polluted an env-sensitive test, NOT because
the agent's code was wrong), **recovering it requires the human to do raw git** \u2014
which contradicts the system's core principle that the RUNNER owns every git-state
transition and the human never does git.

## Root cause (verified in code)

`complete` (`src/complete.ts`) hard-requires the item in `work/in-progress/`:

```ts
// The slice must be in-progress in the working tree (it is what we move).
const inProgress = join(cwd, 'work', 'in-progress', `${slug}.md`);
if (!existsSync(inProgress)) {
  // "work/in-progress/<slug>.md not found — nothing to complete"
}
```

A needs-attention item lives in `work/needs-attention/`, so `complete` REFUSES it
("nothing to complete"). The blocker is PURELY the folder location \u2014 `complete`
otherwise already does exactly what recovery needs (gate + done-move + rebase +
integrate). So the human is forced to manually `git mv needs-attention/ →
in-progress/` (+ a commit, + a rebase that may conflict with the cherry-picked
surfacing commit on `main`) before `complete` will touch it.

## The gap in the command surface

There are TWO needs-attention exits today, and one is missing:

- **`requeue`** (`needs-attention → backlog`) \u2014 the "give up / redo" path. Exists.
- **(missing) "it's fine, finish it"** (`needs-attention → done`) \u2014 the human looked,
  the gate failure was spurious or already fixed, re-gate and complete it. **No
  runner-owned command for this.** The ADR §12 mentions "or resumes on its branch
  directly" as the return path \u2014 that "resume the branch + complete" flow is the
  unbuilt piece.

## Direction (future slice)

Let the runner own the `needs-attention → done` transition: a path (extend
`complete` to accept a `needs-attention/` item, OR a `resume`-then-`complete` flow,
OR a small dedicated verb) that re-runs the GATE on the stuck item's branch and, if
green, completes it (the runner doing the `git mv` + rebase + integrate). The human
says "this is good now"; the runner does the git \u2014 same principle as every other
transition.

- **Pairs with `requeue`:** `requeue` = give up/redo; this = it's fine, finish it.
- **The gate stays authoritative:** recovery must RE-RUN the gate (not trust the
  human blindly) \u2014 it only completes if the gate is now green, so a genuinely-bad
  item can't be force-completed through this path (use `--skip-verify` deliberately
  if ever needed, human-only, loud).
- **Mind the surfacing reconciliation:** the needs-attention move was cherry-picked
  to `<arbiter>/main` (the on-`main` surfacing); completing the item must reconcile
  that (the manual recovery hit exactly this as a rebase conflict). The
  runner-owned path should handle it so the human doesn't.

## Relation to other work

- Pairs with `human-face-verbs`' `resume` (re-engage an in-progress item) \u2014 this is
  the needs-attention analogue.
- Spotted alongside two sibling findings this session: the env-pollution that CAUSED
  the spurious failure (`work/observations/repo-config-tests-read-ambient-env.md` \u2014
  the gate should run with `AGENT_RUNNER_*` scrubbed, or those tests inject `env`),
  and the `do --watch` event-format mismatch.

## Why an observation, not a work item yet

Spotted live (3 runs in); the fix is a clean, valuable slice but the exact shape
(extend `complete` vs `resume`+`complete` vs a new verb) + the surfacing-commit
reconciliation are choices to settle when sliced. Captured so the recovery-ergonomics
gap is not forgotten \u2014 it became visible only by hitting the rough recovery
repeatedly. Delete once a runner-owned `needs-attention → done` path lands.
