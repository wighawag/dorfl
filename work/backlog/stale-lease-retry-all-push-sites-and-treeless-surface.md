---
title: stale-lease-retry-all-push-sites-and-treeless-surface — extend the stale-lease push retry (#88's helper) to the TWO uncovered sibling continue-path push sites, AND make a push-failure that strands ALREADY-COMMITTED work surface to needs-attention TREE-LESSLY (the requeue CAS primitive, no worktree) instead of leaving the slice silently in-progress
slug: stale-lease-retry-all-push-sites-and-treeless-surface
covers: []
---

> Self-contained fix slice — derives from NO PRD (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Source signals (mark resolved on landing): `work/observations/stale-lease-retry-only-on-job-worktree-path.md` (the two uncovered push sites) and `work/observations/needs-attention-route-claims-pushed-when-push-silently-failed.md` (the surfacing-after-push-failure gap). Builds on the SHIPPED `work-branch-push-retry-on-stale-lease` (#88, the retry helper) and `requeue-treeless-transition` (#89, the tree-less CAS ledger move).
>
> WHY: a `do --isolated` continue-from-requeued-branch run built green (gate-1 + Gate-2 approved), then its final `git push <branch> --force-with-lease=<branch>` was REJECTED ("stale info" — the remote branch ref had moved under the lease). The run errored out of the push BEFORE surfacing, leaving the slice silently in `work/in-progress/` on the arbiter with the approved work stranded in the job worktree — a human had to push by hand (it was a clean fast-forward) + finish the integration. Both failure modes are already-captured gaps; this slice closes them.

## What to build

### Part A — extend the stale-lease retry to ALL continue-path push sites

`#88` added `pushContinuedBranchWithStaleLeaseRetry` (`src/continue-branch.ts`) and wired it into ONE site: the `createJob` continue path in `src/workspace.ts:243` (the `run`/`do --remote`/`--isolated` job-worktree path). But the SAME single `git push <arbiter> <branch>:<branch> --force-with-lease=<branch>` continue-path push — with the SAME latent stale-lease failure — exists UNGUARDED in two sibling sites (per `stale-lease-retry-only-on-job-worktree-path.md`):

- **`src/isolation.ts:266`** — the in-place checkout strategy's already-pushed-tip reconcile push.
- **`src/start.ts:553`** (`switchToWorkBranch`) — the requeued-branch reconcile push.

Factor BOTH through `pushContinuedBranchWithStaleLeaseRetry` so the retry-on-stale-lease (re-fetch the branch + re-rebase + retry; fast-forward needs no force; a genuinely-diverged re-rebase that CONFLICTS routes to needs-attention and NEVER auto-resolves) applies uniformly. The incident hit one of these uncovered paths (the `--isolated` continue threads through the isolation/job-worktree machinery), so closing them is what makes that exact run self-recover.

### Part B — a push-failure that stranded ALREADY-COMMITTED work surfaces to needs-attention TREE-LESSLY (no worktree)

When the continue-path push ULTIMATELY fails (retry exhausted, or a non-stale-lease rejection) AFTER the work is committed + the done-move applied on the branch, the run must NOT error out leaving the slice silently in `work/in-progress/` on the arbiter (the observed bug). It must SURFACE to `needs-attention/` — but **tree-lessly**, reusing the `requeue-treeless-transition` (#89) CAS primitive:

> **The work is ALREADY committed on the `work/<slug>` branch — surfacing needs only the `in-progress/ → needs-attention/` LEDGER move (the `.md` git-mv + reason block), pushed via the tree-less CAS (`ledgerWrite.applyTransition`), exactly as `requeue` moves `needs-attention/ → backlog/`. Re-materialising a job worktree just to write a one-file folder-move is NEEDLESS — the human-facing artifacts (the committed code on the branch + the reason on main) are all that's required.**

So: route the post-commit push-failure through the SAME tree-less needs-attention transition `requeue`/the #89 work uses (a throwaway-clone CAS push of the ledger move against the arbiter, NO worktree, NO checkout of the item). The reason block records WHY (stale-lease / push rejected after N retries) so a human (or a `requeue` + re-`do`) can recover — the kept branch already carries the green work, so recovery is a clean continue.

DISTINGUISH the two failure timings (do not conflate):
- Push fails BEFORE the work is committed/done-moved → existing behaviour (whatever it is) is out of scope; this slice is about the AFTER-commit strand.
- Push fails AFTER the work is committed + done-moved on the branch → Part B: tree-less surface to needs-attention, branch (with the green work) left intact on the arbiter, recoverable.

## Scope

- IN: route `isolation.ts:266` + `start.ts:553` pushes through `pushContinuedBranchWithStaleLeaseRetry` (Part A); make the after-commit continue-path push-failure surface to needs-attention via the tree-less CAS ledger move (Part B), reusing the #89 primitive (NO worktree re-materialisation); tests for both.
- OUT: changing the retry helper's logic itself (#88 shipped it — reuse, don't rewrite); the tree-less CAS primitive itself (#89 shipped it — reuse); the BEFORE-commit push-failure path; main is NEVER force-pushed (§11 invariant unchanged); auto-resolving a genuinely-conflicting rebase (still routes to needs-attention).

## Acceptance criteria

- [ ] `src/isolation.ts` (~:266) and `src/start.ts` `switchToWorkBranch` (~:553) push the continued work branch through `pushContinuedBranchWithStaleLeaseRetry` — a stale-lease rejection on EITHER path now re-fetches + re-rebases + retries (and a clean fast-forward needs no force), instead of failing the run. (Regression test per site: a stale-lease rejection is recovered and the work lands.)
- [ ] A genuinely-DIVERGED re-rebase that CONFLICTS on retry routes to needs-attention and is NEVER auto-resolved (parity with #88's `workspace.ts` path).
- [ ] After-commit push-failure (retry exhausted, or a non-stale-lease rejection) surfaces the slice to `work/needs-attention/` via the TREE-LESS CAS ledger move (the `requeue-treeless-transition`/#89 primitive — `ledgerWrite.applyTransition`), with NO job-worktree re-materialisation and NO checkout of the item; the reason block records the push-failure cause.
- [ ] The stranded work is RECOVERABLE: the `work/<slug>` branch (with the committed green work + done-move) is left intact on the arbiter; a subsequent `requeue` + re-`do` continues from its tip (the existing keep+continue recovery).
- [ ] The slice is NO LONGER left silently in `work/in-progress/` on the arbiter after an after-commit push-failure (the observed bug) — assert it lands in `needs-attention/`.
- [ ] `main` is never force-pushed; a fast-forward continue-branch push uses no force (the safe-distinction preserved).
- [ ] Tests use the house pattern (throwaway repos + local `--bare` arbiter; temp `workspacesDir`; `isolatePiAgentDir`; real shared dirs untouched); the tree-less surface is asserted to touch NO worktree.
- [ ] `pnpm format:check && pnpm build && pnpm test` green (this repo's gate).
- [ ] On landing: mark `work/observations/stale-lease-retry-only-on-job-worktree-path.md` and `work/observations/needs-attention-route-claims-pushed-when-push-silently-failed.md` RESOLVED.

## Prompt

> Two-part fix for a stale-lease push that strands already-green work. A `do --isolated` continue-run built green (gate-1 + Gate-2 approved), then its final `git push <branch> --force-with-lease=<branch>` was REJECTED ("stale info" — the remote branch ref moved under the lease) and the run errored out BEFORE surfacing, leaving the slice silently in `work/in-progress/` on the arbiter with the approved work stranded in the job worktree (a human had to push by hand — a clean fast-forward — and finish the integration). Sources (READ; mark resolved on landing): `work/observations/stale-lease-retry-only-on-job-worktree-path.md`, `work/observations/needs-attention-route-claims-pushed-when-push-silently-failed.md`.
>
> PART A: `#88` (`work-branch-push-retry-on-stale-lease`, DONE) added `pushContinuedBranchWithStaleLeaseRetry` (`src/continue-branch.ts`) but wired it ONLY into `src/workspace.ts:243` (the createJob continue path). Route the TWO sibling continue-path pushes through the SAME helper: `src/isolation.ts:266` (in-place checkout strategy's already-pushed-tip reconcile) and `src/start.ts:553` `switchToWorkBranch` (requeued-branch reconcile). Reuse the helper, do NOT rewrite it — its contract: stale-lease → re-fetch + re-rebase + retry; fast-forward → no force; a CONFLICTING re-rebase → route to needs-attention, never auto-resolve; main never force-pushed.
>
> PART B: when the continue-path push ULTIMATELY fails AFTER the work is committed + done-moved on the branch, do NOT error out leaving the slice silently in-progress. SURFACE it to `needs-attention/` TREE-LESSLY, reusing the `requeue-treeless-transition` (#89, DONE) CAS primitive (`ledgerWrite.applyTransition`): the work is ALREADY committed on the branch, so surfacing needs ONLY the `in-progress/ → needs-attention/` ledger move (the `.md` git-mv + reason block) pushed via the tree-less CAS — NO job-worktree re-materialisation, NO checkout of the item (that would be needless work). Leave the `work/<slug>` branch (green work + done-move) intact on the arbiter so a `requeue` + re-`do` continues from its tip. The reason block records the push-failure cause.
>
> READ FIRST: `src/continue-branch.ts` `pushContinuedBranchWithStaleLeaseRetry` (the helper to reuse + its outcome type); `src/workspace.ts:243` (the one wired call site — mirror it); `src/isolation.ts:~266` + `src/start.ts:~553` `switchToWorkBranch` (the two uncovered sites); `src/needs-attention.ts` `routeToNeedsAttention` (the surfacing seam) + how `requeue-treeless-transition` routed it through `ledgerWrite.applyTransition` tree-lessly; `src/do.ts` `performDoRemote` (the after-commit push step that errored before surfacing — the path to make surface instead).
>
> Distinguish BEFORE-commit (out of scope) vs AFTER-commit (Part B) push-failure timing. TDD with vitest, house style (throwaway repos + local `--bare` arbiter; temp `workspacesDir`; `isolatePiAgentDir`; assert the tree-less surface touches NO worktree + the real shared dirs are untouched). "Done" = both sibling sites retry on stale-lease, an after-commit push-failure surfaces to needs-attention tree-lessly (not silently in-progress) with the branch recoverable, main never force-pushed, and the gate green.

---

### Claiming this slice

```sh
agent-runner claim stale-lease-retry-all-push-sites-and-treeless-surface --arbiter origin
git fetch origin && git switch -c work/stale-lease-retry-all-push-sites-and-treeless-surface origin/main
git mv work/in-progress/stale-lease-retry-all-push-sites-and-treeless-surface.md work/done/stale-lease-retry-all-push-sites-and-treeless-surface.md
```
