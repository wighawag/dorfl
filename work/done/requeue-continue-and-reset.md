---
title: requeue keeps the branch + next claim CONTINUES from its tip; --reset deletes the remote branch + starts fresh; --message threads a handoff note
slug: requeue-continue-and-reset
prd: command-surface-phase-2
blockedBy: []
covers: []
---

## What to build

Today `requeue` (the `return` verb) moves the ledger file `needs-attention/ → backlog/` and leaves the `work/<slug>` branch untouched — BUT the next claim/start cuts a FRESH branch off `<arbiter>/main`, orphaning the prior work. So requeue is effectively "retry from scratch," and the prior agent's work is silently dropped on re-claim. This slice makes the model coherent: **the `work/<slug>` branch is the durable artifact, continued across attempts by default.**

Three changes (one keystone behaviour + a destructive opt-out + a handoff note):

1. **`requeue` (default) = KEEP + CONTINUE.** Keep the branch (already does), and make the **next claim continue from the existing `work/<slug>` branch tip** instead of force-cutting a fresh branch off main. Concretely: when a claim/start (or `do`) onboards a slug whose `work/<slug>` branch EXISTS on the arbiter (ahead of main), it must build on THAT branch, NOT `switch -c` a fresh one off main. (The branch must be on the ARBITER so a DIFFERENT machine's agent can continue it — which it is: stuck items push the branch via `routeToNeedsAttention(arbiter)`.) Single-branch model: one `work/<slug>`, accumulating across attempts (no versioning/counters — consistent with content-slug-not-counter).
   - **BOTH onboarding paths must continue — in-place AND job-worktree (load-bearing for the goal).** Continue-detection must apply wherever a claim onboards onto `work/<slug>`, which is TWO distinct code paths today, not one:
     - **in-place** (`do`/`start`/`work-on`): `src/start.ts` `switchToWorkBranch` (currently `switch -c work/<slug> <arbiter>/main`, silently fresh). and
     - **job-worktree** (`do --remote`/`run`): `src/workspace.ts` `createJob` (currently `git worktree add -b work/<slug> <dir> main` — fresh off the mirror main, and `clearStale` DROPS any leftover branch first). If only `switchToWorkBranch` is made continue-aware, `do --remote`/`run` (the AFK/fleet case where recovery matters MOST) would still retry-fresh and discard the kept branch — the §14 goal would be UNMET for the job-worktree path. So this slice must make BOTH paths continue: `createJob`, when an arbiter `work/<slug>` exists ahead of main, cuts the worktree from THAT branch (fetched into the mirror) instead of fresh off main, and `clearStale` must not nuke the branch being continued. Factor the "is there an arbiter `work/<slug>` ahead of main?" detection into ONE shared helper both paths call.
   - **REBASE the continued branch onto the freshly-fetched main AT ONBOARD-TIME** (not just at `complete`). The prior attempt's commits are based on an OLD main (main moved while the item sat in needs-attention/backlog). Replaying them onto current main before the agent works means the agent builds on a CURRENT base (less conflict surface, correct context) — not on stale commits that `complete`'s end-rebase would later have to reconcile against a more-diverged main. Use **rebase, not merge** (consistent with ADR §10 rebase-or-abort + the existing `complete` rebase; linear history, no merge-commit noise accumulating per requeue cycle). A **conflicting rebase → needs-attention** (the SAME §10 path every rebase conflict uses; the human resolves or `--reset`s).
   - **Pushing the rebased continued branch may be non-fast-forward** (rebase rewrites SHAs vs the already-pushed tip). Reconcile with **`--force-with-lease` on the WORK BRANCH** — justified because a requeued item is, by contract, not shared (nobody else is building on it; same reasoning as `--reset`'s delete). This is distinct from and does NOT weaken the "NEVER `--force` to **main**" invariant (§11) — it is a lease-guarded force on a private work branch, never main. (Where the continue stays local until `complete`, `complete`'s existing rebase+push handles it; the force-with-lease is only for updating an already-pushed work-branch tip.)

2. **`requeue --reset` = DISCARD + FRESH.** At REQUEUE-TIME (not claim-time): **delete the remote branch FIRST**, then do the ledger `needs-attention → backlog` move. Deletion is plain provider-agnostic git: `git push <arbiter> --delete work/<slug>` (+ drop any stale LOCAL `work/<slug>`). Order matters: delete BEFORE the backlog move so there is no window where the item is claimable (in backlog) while the to-be-discarded branch still exists (a re-claim's continue-detection would wrongly continue it). Fail-safe: if the branch-delete push FAILS (e.g. offline), do NOT proceed to the backlog move — leave the item in needs-attention rather than create a backlog item that continues from a branch you meant to discard.
   - **Claim-time logic is UNCHANGED.** `--reset` needs no special "start fresh" behaviour at claim-time: because the branch is already gone, the continue- detection (change #1) simply finds no arbiter `work/<slug>` and falls through to the normal fresh-cut-off-main path. `--reset` and the default differ ONLY at requeue-time (delete-or-keep); the claim path just reacts to "branch present?".
   - This is a DELIBERATE, VISIBLE departure from the codebase's loud "NEVER delete the remote branch" invariant (`complete.ts`, `cli.ts`) — explicit/guarded, never the default. Plain delete is fine (`--reset` MEANS throw-away; revisit a rename-aside-to-`discarded/` only if a real "undo my reset" need appears).

3. **`requeue [--message/-m "..."]` = HANDOFF NOTE.** An optional human note threaded to the NEXT agent. Persist it by APPENDING a dated entry to the item's body (e.g. a `## Requeue YYYY-MM-DD` section) — the ledger file is the durable, conflict-safe, cross-machine home (rule 1; same place the needs-attention reason lives). Append, never overwrite (multiple requeues accumulate a handoff log). The message applies to BOTH modes (a human's steer is relevant even on `--reset`). The continuing agent reads it via the prompt (the `agent-prompt-continue-context` slice consumes it); this slice's job is to WRITE it.

## Acceptance criteria

- [ ] `requeue <slug>` (default) keeps the `work/<slug>` branch; a subsequent claim/start CONTINUES from its tip (builds on the existing arbiter branch, does NOT force-cut a fresh branch off main). A test proves the prior commit is present on the branch the next claim lands on.
- [ ] On continue, the branch is REBASED onto the freshly-fetched main at onboard-time (agent builds on a current base); a CLEAN rebase continues, a CONFLICTING rebase routes to needs-attention (the §10 path). A test with a moved main proves the continued branch is replayed onto it (and that a conflict bounces, not auto-resolves).
- [ ] Updating an already-pushed continued branch after rebase uses `--force-with-lease` on the WORK branch only (never main); a test asserts the reconciled remote tip and that main is never force-pushed.
- [ ] `requeue <slug> --reset` deletes the remote branch (`git push <arbiter> --delete work/<slug>`, works against a local `--bare` arbiter) + any stale local branch FIRST, THEN does the backlog move; the next claim starts FRESH off main (prior commit absent) with no special claim-time logic (the branch is simply gone). A test proves delete-before-move ordering and that a FAILED delete leaves the item in needs-attention (does not move to backlog). The deletion is explicit/guarded — never on the default path.
- [ ] `requeue <slug> -m "<note>"` appends a dated handoff entry to the item body (append-only across repeated requeues); present for both default and `--reset`.
- [ ] The continue-detection ("does the arbiter have a `work/<slug>` ahead of main?") is ONE shared helper called by BOTH onboarding paths: `switchToWorkBranch` (in-place: `do`/`start`/`work-on`) AND `createJob` (job-worktree: `do --remote`/`run`). A test proves a CONTINUE works through the JOB-WORKTREE path (not only in-place) — i.e. `createJob` cuts the worktree from the kept arbiter branch, and `clearStale` does not nuke it. (Without this the §14 goal is unmet for the fleet/AFK case.)
- [ ] **Test isolation:** tests use a local `--bare` arbiter + temp dirs and assert no real shared dir is touched (no pi launch here, so the git-isolation env is sufficient).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — operates on the existing `requeue`/`start`/claim machinery.

## Prompt

> Make `requeue` the coherent "keep + continue" verb, with `--reset` as the explicit throw-away. Today requeue moves the ledger file back to backlog but the next claim cuts a FRESH branch off main (orphaning prior work). Change it so the single `work/<slug>` branch is the durable artifact, continued across attempts.
>
> THREE behaviours:
>
> 1. `requeue` (default): keep the branch; the NEXT claim CONTINUES from the existing `work/<slug>` tip on the arbiter, building on it (NOT fresh off main). CRITICAL: continue must work through BOTH onboarding paths — `switchToWorkBranch` (in-place: `do`/`start`/`work-on`) AND `createJob` (job-worktree: `do --remote`/`run`, the AFK case where recovery matters most). One shared "arbiter `work/<slug>` ahead of main?" detection feeds both; `createJob` cuts from the kept branch (and `clearStale` must not drop it). Wiring only the in-place path leaves the fleet case retrying-fresh — the goal unmet. REBASE the continued branch onto the freshly-fetched main at onboard-time (rebase, not merge — §10 consistency + linear history; conflict → needs-attention via the §10 path) so the agent works on a current base; updating an already-pushed tip after rebase uses `--force-with-lease` on the WORK branch only (justified: a requeued item is unshared) — NEVER `--force` to main (§11).
> 2. `requeue --reset`: at requeue-time, delete the remote branch FIRST (`git push <arbiter> --delete work/<slug>`, plain provider-agnostic git — works on a `--bare` arbiter) + drop any stale local branch, THEN the backlog move (delete-before-move closes the claim-race window; a FAILED delete aborts the requeue, leaving it in needs-attention). Claim-time is unchanged — the next claim cuts fresh naturally because the branch is gone. Explicit/guarded — a deliberate departure from the loud "never delete the remote branch" invariant (see `complete.ts`/`cli.ts`); never on the default path.
> 3. `requeue -m "<note>"`: append a dated handoff note to the item body (append-only; applies to both modes) for the next agent.
>
> READ FIRST: `src/needs-attention.ts` (`returnToBacklog` — today's requeue move; and `routeToNeedsAttention`'s arbiter branch-push — why the branch is ON the arbiter to continue from); `src/start.ts` (`switchToWorkBranch` — the `switch -c` off main this must make continue-aware) + `src/workspace.ts` (`createJob` — `git worktree add -b ... main`, the JOB-WORKTREE onboarding `do --remote`/`run` use, which must ALSO become continue-aware; and `clearStale`, which must not drop the continued branch) + `src/claim-cas.ts`; `src/do.ts`; `src/run.ts`; `src/cli.ts` (the `return`/`requeue` command — note `flag-cleanup-renames` renames `return`→`requeue`; wire whichever name is current). CONTEXT.md (single content-slug branch, no counters) + WORK-CONTRACT (file is the conflict-safe home for the handoff note).
>
> Drift check: confirm requeue is still the ledger-only move and the claim/start path still cuts fresh off main (if a sibling already added continue, reconcile).
>
> TDD with vitest, house style (local `--bare` arbiter, temp dirs): continue keeps the prior commit; `--reset` deletes the remote branch and starts fresh; `-m` appends a handoff note (and accumulates over repeated requeues). "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim requeue-continue-and-reset --arbiter <remote>
git fetch <remote> && git switch -c work/requeue-continue-and-reset <remote>/main
git mv work/in-progress/requeue-continue-and-reset.md work/done/requeue-continue-and-reset.md
```
