---
title: the autonomous GATE-FAIL path must push the work branch too (parity with agent-fail) + fix the false run.ts comment
slug: gate-fail-pushes-work-branch
blockedBy: []
covers: []
---

## What to build

> Self-contained fix — derives from NO PRD (`covers: []`), so it omits `prd:` and
> is its own source of truth. Verified gap, evidenced by two observation notes:
> `work/observations/needs-attention-seam-drops-arbiter-branch-push.md` (PR #6) and
> `work/observations/needs-attention-seam-does-not-push-work-branch.md` (PR #8).

`agent-fail-saves-work` (PR #8) fixed the AGENT-failure path to push the
`work/<slug>` branch to the arbiter (so the partial work is cross-machine
recoverable via `requeue`-continue). But the autonomous **GATE-failure** path has
the SAME latent gap and was left unfixed:

- The ledger write seam's `applyNeedsAttentionTransition(arbiter)` (mode-M)
  surfaces the **ledger** (the move-only commit) on `<arbiter>/main` via
  `publishSurfaceCommit`, but it does **NOT push the `work/<slug>` branch**. The wip
  commit (the aborted work) stays only on the LOCAL work branch — in `run`/`do`'s
  job worktree, which is disposable.
- So when an autonomous **red gate** bounces an item to needs-attention
  (`src/run.ts` step 5; the `do` gate-fail path via `complete`/`surfaceArbiter`),
  the wip is surfaced as a stuck item but the BRANCH is not on the arbiter. A
  `requeue`-continue on a DIFFERENT machine finds no `<arbiter>/work/<slug>` ahead
  of main (continue-detection in `continue-branch.ts` reads that ref) and re-cuts
  FRESH off main — orphaning the gate-fail wip. The cross-machine recovery §14
  promises is unmet for the gate-fail case (it IS met for agent-fail after PR #8).

Two changes:

1. **Push the work branch on the autonomous gate-fail bounce**, mirroring exactly
   what `saveAgentFailure` (`src/do.ts`, from PR #8) does: after the
   `applyNeedsAttentionTransition(arbiter)` move succeeds, push `work/<slug>` to the
   arbiter (best-effort; an unreachable arbiter leaves the local branch + the
   surface standing — same degradation as the agent-fail path). Apply it wherever
   the autonomous gate-fail routes: `src/run.ts` step 5, and the `do` gate-fail path
   (confirm whether it goes through the same seam call or `complete` —
   `src/complete.ts` / `src/do.ts`). The HUMAN `complete` path (no `surfaceArbiter`)
   stays local-only and pushes nothing (a human is right there — the existing
   autonomous-vs-human divergence the `do` tests already lock; do NOT change it).

2. **Fix the false comment in `src/run.ts`** (≈ line 366): it currently claims
   *"Passing the arbiter both pushes the work branch (saving the wip cross-machine)
   and makes the stuck state observable"* — the seam does NOT push the branch. After
   change #1 the comment becomes true for the wip-cross-machine half ONLY because
   this slice adds the explicit push; reword it to state the seam surfaces the
   LEDGER and the explicit push (this slice's) saves the wip cross-machine.

   - **Consider factoring the shared "save+surface+push" out of `saveAgentFailure`**
     so the gate-fail and agent-fail paths call ONE helper (the push-the-branch
     step is identical). Lean: extract a small `surfaceStuckAndPushBranch(cwd, slug,
     reason, arbiter, env)` both consume — but only if it does not entangle `do`'s
     and `run`'s differing surrounding flow; a duplicated 3-line push is acceptable
     if extraction is awkward. The reviewer's parity check is the real acceptance
     bar, not the factoring.

## Acceptance criteria

- [ ] On an autonomous RED GATE bounce (`run`, and `do`'s gate-fail path), the
      `work/<slug>` branch is PUSHED to the arbiter (in addition to the ledger
      surface on main), so the wip is cross-machine recoverable. A test proves the
      arbiter has `work/<slug>` after a gate-fail and that `requeue`-continue from a
      FRESH clone lands on the branch with the aborted wip present (mirrors PR #8's
      agent-fail recovery test, for the gate-fail case).
- [ ] (Folded in) The autonomous INTEGRATE-TIME REBASE-CONFLICT bounce in `run`
      (`Integrator.integrateWithRebase` → needs-attention) ALSO pushes the work
      branch (the aborted, pre-rebase tip), same as the gate-fail bounce — so a
      `run`-driven conflict on a multi-machine fleet is cross-machine recoverable
      too. A test proves the branch is on the arbiter after the conflict (and the
      worktree is reaped, ADR §4). (`do`/`complete`'s rebase-conflict path is
      covered alongside its gate-fail path.)
- [ ] The HUMAN `complete` path (no `surfaceArbiter`) is UNCHANGED — local-only, no
      branch push (the existing autonomous-vs-human divergence test still passes).
- [ ] The false `src/run.ts` comment (≈L366) is corrected: the seam surfaces the
      LEDGER on main; the explicit push (this slice) saves the wip cross-machine.
- [ ] No regression to the agent-fail path (PR #8) — if the shared push is
      factored into a helper, both paths use it and their tests stay green.
- [ ] **Test isolation:** local `--bare` arbiter + temp dirs + a stubbed agent
      (no real pi launch, like the existing `do` tests); assert real shared dirs
      untouched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — `agent-fail-saves-work` (the parity reference) is already in `done/`.

## Prompt

> The autonomous GATE-FAIL path has the same gap PR #8 fixed for the agent-fail
> path: the needs-attention seam surfaces the LEDGER on `<arbiter>/main` but does
> NOT push the `work/<slug>` branch, so a gate-fail wip is NOT cross-machine
> recoverable (a different machine's `requeue`-continue re-cuts fresh off main,
> orphaning it). Push the work branch on the autonomous gate-fail bounce, mirroring
> `saveAgentFailure` in `src/do.ts`. Also fix the now-false comment in `src/run.ts`
> (≈L366) that claims the seam pushes the branch (it does not).
>
> READ FIRST: `work/observations/needs-attention-seam-does-not-push-work-branch.md`
> + `...-drops-arbiter-branch-push.md` (the verified gap); `src/do.ts`
> (`saveAgentFailure` — the parity reference: it calls
> `applyNeedsAttentionTransition(arbiter)` then `git push <arbiter>
> work/<slug>:work/<slug>`); `src/run.ts` step 5 (the gate-fail bounce + the false
> comment); `src/complete.ts` / the `do` gate-fail path (where `surfaceArbiter` is
> passed — confirm it routes through the same seam call); `src/continue-branch.ts`
> (continue-detection reads `<arbiter>/work/<slug>` — why the push is required).
> Keep the HUMAN `complete` path (no surfaceArbiter) local-only — do NOT change the
> autonomous-vs-human divergence the `do` tests lock.
>
> Optionally factor the shared save+surface+push out of `saveAgentFailure` so both
> the agent-fail and gate-fail paths call one helper — only if it does not entangle
> `do`'s and `run`'s surrounding flow; a duplicated 3-line push is fine otherwise.
>
> TDD with vitest, house style (local `--bare` arbiter, temp dirs, stubbed agent):
> a gate-fail pushes the branch; a FRESH clone's `requeue`-continue recovers the
> aborted wip; the human `complete` path stays local-only. "Done" = acceptance
> criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim gate-fail-pushes-work-branch --arbiter <remote>
git fetch <remote> && git switch -c work/gate-fail-pushes-work-branch <remote>/main
git mv work/in-progress/gate-fail-pushes-work-branch.md work/done/gate-fail-pushes-work-branch.md
```
