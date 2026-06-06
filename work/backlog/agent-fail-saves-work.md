---
title: a non-zero agent exit SAVES partial work (commit + push + route to needs-attention) instead of silently dropping it
slug: agent-fail-saves-work
prd: command-surface-phase-2
blockedBy: [requeue-continue-and-reset]
covers: []
---

## What to build

Inconsistency in `do`'s failure handling: a **gate failure** routes to
needs-attention and PUSHES the work branch (`routeToNeedsAttention(arbiter)`), so
the work is saved + surfaced + continuable. But when the **agent process itself
returns non-zero** (`runDoAgent` → `agent.ok === false`, or it throws), `performDo`
just returns `{outcome: 'agent-failed'}` and EXITS (`src/do.ts`) — it does NOT
commit, push, or route. So whatever partial work the agent committed is left only
on the local branch in the (disposable, possibly remote) job worktree, and any
uncommitted edits are dropped. The agent's partial progress is silently lost.

Make agent-failure behave like a gate-failure: **commit + push + route to
needs-attention**, so the partial work is saved on the arbiter, surfaced by
`status`, and recoverable via `requeue` (which now CONTINUES from the branch — the
`requeue-continue-and-reset` slice). The human reads the failure reason in the body,
fixes the cause, and `requeue`s (continue) or `requeue --reset` (discard) — their
choice.

- **On `agent.ok === false` (or a thrown agent error)**, instead of a bare
  `agent-failed` return: route the item to needs-attention via the SAME
  `routeToNeedsAttention(surfaceArbiter)` path the gate-failure uses — which already
  does `git add -A` + commit (capturing the agent's work) + `git mv → needs-attention`
  + push the branch. The recorded reason is the agent failure detail (its stderr /
  the failure message), so the human knows what happened.
- **Keep the distinct outcome/exit semantics** where they matter: it is still an
  agent failure (distinct from a red gate) for reporting/exit-code purposes, but the
  WORK-PRESERVING side-effect (commit/push/surface) now matches. (Decide: reuse the
  `needs-attention` outcome, or keep `agent-failed` as the outcome label but perform
  the same save+surface — the slice should pick one and keep `do`'s exit contract
  coherent. Lean: surface as needs-attention, reason = "agent failed: <detail>".)
- **Caveat (in scope to handle gracefully):** a failed agent may leave a
  broken/dirty tree. Committing + surfacing it (with the failure reason) is still
  better than dropping it — the human chooses continue vs `--reset`. Do NOT try to
  validate or "fix" the partial work; just preserve + surface it.
- **NOT in scope:** mid-work HARD interruption (kill -9 / machine shutdown) — there
  is no graceful exit to hook, and uncommitted work is inherently lossy. That case
  is accepted (no periodic auto-commit — it would sweep untracked artifacts, the
  bug the tree-cleanliness slice fixed). This slice only covers the agent
  RETURNING a failure.

## Acceptance criteria

- [ ] When the agent returns non-zero (or throws), `do` commits the agent's work +
      pushes the `work/<slug>` branch + routes the item to needs-attention with the
      failure detail as the reason — instead of silently exiting. (Same
      work-preserving path as a gate failure.)
- [ ] The saved work is recoverable: after the failure, `requeue` (continue) lands a
      re-claim on the branch WITH the partial commits present (proves end-to-end with
      `requeue-continue-and-reset`).
- [ ] `do`'s exit code / reporting still distinguishes an agent failure from a clean
      success and from a gate failure (coherent exit contract); the change is the
      work-preserving side-effect, not the diagnosis.
- [ ] A genuinely empty failure (agent made NO commits / no changes) is handled
      without error (nothing to commit → still surface the failure reason; do not
      crash on an empty commit).
- [ ] **Test isolation:** local `--bare` arbiter + temp `workspacesDir` +
      `isolatePiAgentDir`; assert real shared dirs untouched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `requeue-continue-and-reset` — the recovery story (saved work is continued via
  requeue) depends on continue-from-branch existing.

## Prompt

> Fix `do`'s inconsistent failure handling: a gate failure saves work (routes to
> needs-attention + pushes the branch), but an AGENT failure (`runDoAgent` returns
> `ok:false` or throws) just exits and drops the partial work. Make agent-failure
> save work the SAME way: commit + push + route to needs-attention with the failure
> detail as the reason, so it is recoverable via `requeue` (continue).
>
> READ FIRST: `src/do.ts` (`performDo` — the two `agent-failed` return points after
> `runDoAgent`; and step 6 where gate-fail already routes via `performComplete` /
> `surfaceArbiter`); `src/needs-attention.ts` (`routeToNeedsAttention` — the
> commit+`git mv`+arbiter branch-push to reuse); `src/complete.ts` (how the
> gate-fail path calls it, for parity). Decide whether to surface as the
> needs-attention outcome or keep an `agent-failed` label while performing the same
> save — keep `do`'s exit contract coherent. Handle the empty-failure (no commits)
> case without crashing on an empty commit.
>
> Drift check: confirm `do` still bare-returns on agent failure (if a sibling
> already changed it, reconcile).
>
> NOT in scope: hard mid-work interruption (kill/shutdown) — accepted as lossy; no
> periodic auto-commit (would sweep untracked artifacts).
>
> TDD with vitest, house style (local `--bare` arbiter, temp agents' area,
> `isolatePiAgentDir`, a stubbed pi/agent that exits non-zero after editing): the
> failure saves+pushes+surfaces; requeue-continue recovers the partial commits; the
> empty-failure case is clean. "Done" = acceptance criteria met and gate green.

---

### Claiming this slice

```sh
agent-runner claim agent-fail-saves-work --arbiter <remote>
git fetch <remote> && git switch -c work/agent-fail-saves-work <remote>/main
git mv work/in-progress/agent-fail-saves-work.md work/done/agent-fail-saves-work.md
```
