---
title: requeue keeps the branch + next claim CONTINUES from its tip; --reset deletes the remote branch + starts fresh; --message threads a handoff note
slug: requeue-continue-and-reset
prd: command-surface-phase-2
blockedBy: []
covers: []
---

## What to build

Today `requeue` (the `return` verb) moves the ledger file `needs-attention/ →
backlog/` and leaves the `work/<slug>` branch untouched — BUT the next claim/start
cuts a FRESH branch off `<arbiter>/main`, orphaning the prior work. So requeue is
effectively "retry from scratch," and the prior agent's work is silently dropped
on re-claim. This slice makes the model coherent: **the `work/<slug>` branch is the
durable artifact, continued across attempts by default.**

Three changes (one keystone behaviour + a destructive opt-out + a handoff note):

1. **`requeue` (default) = KEEP + CONTINUE.** Keep the branch (already does), and
   make the **next claim continue from the existing `work/<slug>` branch tip**
   instead of force-cutting a fresh branch off main. Concretely: when a claim/start
   (or `do`) onboards a slug whose `work/<slug>` branch EXISTS on the arbiter (ahead
   of main), it must **check out / fast-forward to that branch** and build on it,
   NOT `switch -c` a fresh one off main. (The branch must be on the ARBITER so a
   DIFFERENT machine's agent can continue it — which it is: stuck items push the
   branch via `routeToNeedsAttention(arbiter)`.) This is the single-branch model:
   one `work/<slug>`, accumulating across attempts (no versioning/counters —
   consistent with content-slug-not-counter).

2. **`requeue --reset` = DISCARD + FRESH.** Delete the remote branch and start the
   next attempt clean off main. Deletion is plain provider-agnostic git:
   `git push <arbiter> --delete work/<slug>` (works against GitHub OR a `--bare`
   arbiter — no provider seam). This is a DELIBERATE, VISIBLE departure from the
   codebase's loud "NEVER delete the remote branch" invariant (`complete.ts`,
   `cli.ts`) — so it must be explicit/guarded (only on `--reset`, with a clear
   note), never the default. Also delete any stale LOCAL `work/<slug>` so the fresh
   claim cuts cleanly off main. (Plain delete is fine — `--reset` MEANS throw-away;
   revisit a rename-aside-to-`discarded/` only if a real "undo my reset" need
   appears.)

3. **`requeue [--message/-m "..."]` = HANDOFF NOTE.** An optional human note threaded
   to the NEXT agent. Persist it by APPENDING a dated entry to the item's body
   (e.g. a `## Requeue YYYY-MM-DD` section) — the ledger file is the durable,
   conflict-safe, cross-machine home (rule 1; same place the needs-attention reason
   lives). Append, never overwrite (multiple requeues accumulate a handoff log).
   The message applies to BOTH modes (a human's steer is relevant even on `--reset`).
   The continuing agent reads it via the prompt (the `agent-prompt-continue-context`
   slice consumes it); this slice's job is to WRITE it.

## Acceptance criteria

- [ ] `requeue <slug>` (default) keeps the `work/<slug>` branch; a subsequent
      claim/start CONTINUES from its tip (checks out/ff the existing arbiter branch,
      does NOT force-cut a fresh branch off main). A test proves the prior commit is
      present on the branch the next claim lands on.
- [ ] `requeue <slug> --reset` runs `git push <arbiter> --delete work/<slug>`
      (works against a local `--bare` arbiter), removes any stale local branch, and
      the next claim starts FRESH off main (prior commit absent). The deletion is
      explicit/guarded — never on the default path.
- [ ] `requeue <slug> -m "<note>"` appends a dated handoff entry to the item body
      (append-only across repeated requeues); present for both default and `--reset`.
- [ ] The continue-detection ("does the arbiter have a `work/<slug>` ahead of
      main?") is shared by the claim/start path so `do`, `start`, and `work-on`
      onboarding all continue consistently.
- [ ] **Test isolation:** tests use a local `--bare` arbiter + temp dirs and assert
      no real shared dir is touched (no pi launch here, so the git-isolation env is
      sufficient).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — operates on the existing `requeue`/`start`/claim machinery.

## Prompt

> Make `requeue` the coherent "keep + continue" verb, with `--reset` as the
> explicit throw-away. Today requeue moves the ledger file back to backlog but the
> next claim cuts a FRESH branch off main (orphaning prior work). Change it so the
> single `work/<slug>` branch is the durable artifact, continued across attempts.
>
> THREE behaviours:
> 1. `requeue` (default): keep the branch; the NEXT claim/start CONTINUES from the
>    existing `work/<slug>` tip on the arbiter (check out / fast-forward it, do NOT
>    `switch -c` fresh off main). Requires a shared "branch exists ahead of main?"
>    detection in the claim/start onboarding so `do`/`start`/`work-on` all continue.
> 2. `requeue --reset`: `git push <arbiter> --delete work/<slug>` (plain
>    provider-agnostic git — works on a `--bare` arbiter too) + drop any stale local
>    branch, then the next claim starts fresh off main. Explicit/guarded — this is a
>    deliberate departure from the loud "never delete the remote branch" invariant
>    (see `complete.ts`/`cli.ts`); never on the default path.
> 3. `requeue -m "<note>"`: append a dated handoff note to the item body (append-only;
>    applies to both modes) for the next agent.
>
> READ FIRST: `src/needs-attention.ts` (`returnToBacklog` — today's requeue move;
> and `routeToNeedsAttention`'s arbiter branch-push — why the branch is ON the
> arbiter to continue from); `src/start.ts` (`switchToWorkBranch` — the `switch -c`
> off main this must make continue-aware) + `src/claim-cas.ts`; `src/do.ts`;
> `src/cli.ts` (the `return`/`requeue` command — note `flag-cleanup-renames` renames
> `return`→`requeue`; wire whichever name is current). CONTEXT.md (single
> content-slug branch, no counters) + WORK-CONTRACT (file is the conflict-safe home
> for the handoff note).
>
> Drift check: confirm requeue is still the ledger-only move and the claim/start
> path still cuts fresh off main (if a sibling already added continue, reconcile).
>
> TDD with vitest, house style (local `--bare` arbiter, temp dirs): continue keeps
> the prior commit; `--reset` deletes the remote branch and starts fresh; `-m`
> appends a handoff note (and accumulates over repeated requeues). "Done" =
> acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim requeue-continue-and-reset --arbiter <remote>
git fetch <remote> && git switch -c work/requeue-continue-and-reset <remote>/main
git mv work/in-progress/requeue-continue-and-reset.md work/done/requeue-continue-and-reset.md
```
