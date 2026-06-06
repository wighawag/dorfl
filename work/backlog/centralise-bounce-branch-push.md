---
title: centralise the bounce-time work-branch push INTO the needs-attention seam (one home, transition-kind-agnostic) — and route run's agent-failure through it
slug: centralise-bounce-branch-push
blockedBy: [gate-fail-pushes-work-branch]
covers: []
---

## What to build

> Self-contained architectural consolidation — derives from NO PRD (`covers: []`),
> its own source of truth. Promotes the recurring-asymmetry finding captured across
> PR #6/#8/#9 and `work/observations/needs-attention-seam-*.md` +
> `work/observations/run-agent-failure-does-not-save-work.md`.

We have now patched the SAME asymmetry FOUR times (PR #8 `do` agent-fail; PR #9
`run` gate-fail + `run` integrate-conflict + `complete` rebase-conflict), with a
FIFTH still missing (`run` agent-failure bare-returns without saving — see the
observation). The root cause is structural, not incidental:

**The push ALREADY EXISTS in the helper — the SEAM WRAPPER withholds it.** The
underlying `routeToNeedsAttention` (`src/needs-attention.ts`) ALREADY pushes the
branch when given an `arbiter` (its tail: `if (options.arbiter) { const branch =
\`work/${slug}\`; gitHard(['push', arbiter, ...]) }`) — but it **hardcodes
`work/<slug>`** and uses `gitHard` (throws on failure, not best-effort). The bug is
in the SEAM WRAPPER `ledgerWrite.applyNeedsAttentionTransition`, which deliberately
**STRIPS the arbiter from the move** (`const {arbiter, ...move} = input`) so the
helper's own push NEVER fires through the seam — it uses the arbiter ONLY to publish
the ledger surface on `main`. That strip was deliberate under a since-falsified
assumption ("the retained job worktree is the never-lose-work signal"), which holds
only for SINGLE-machine recovery. For CROSS-machine recovery (§14: requeue-continue
reads `<arbiter>/work/<slug>`), every caller has had to BOLT a separate
`pushWorkBranch` call next to the seam call — forgotten in one path (`run`
agent-fail), and now duplicated as a `pushWorkBranch` helper in BOTH `run.ts`
(`src/run.ts:526`) and `complete.ts` (`src/complete.ts:893`). So there are THREE
push sites: the helper's own (unreachable via the seam) + the two bolted-on copies.
"Record stuck" and "save the work durably" are two halves of one operation that the
seam split apart; nothing enforces they happen together.

**Fix: make a needs-attention bounce ONE complete operation — push the work branch
INSIDE the seam, transition-kind-agnostic.**

1. **Stop the seam stripping the arbiter; let the (now-fixed) helper push.** The
   fix is NOT to invent a new push — it is to STOP `applyNeedsAttentionTransition`
   dropping the arbiter (`const {arbiter, ...move}`) so the helper's existing push
   fires through the seam, in addition to publishing the ledger surface on `main`.
   Then DELETE the bolted-on `pushWorkBranch` calls + the duplicated helpers in
   `run.ts` and `complete.ts`. Every caller becomes a SINGLE seam call with no
   tacked-on push — so the asymmetry CANNOT recur (no second step to forget). One
   home for the push: the helper, fired through the seam.
   - **Best-effort, not throw.** The helper's push is `gitHard` (throws on a failed
     push). The bolted-on pushes were best-effort (an unreachable arbiter leaves
     the local branch + main surface standing — recovery degrades, never crashes
     the bounce). Soften the helper's push to best-effort so an offline arbiter
     does not turn a needs-attention bounce into a hard error (parity with what the
     bolted-on copies + `saveAgentFailure` do).

2. **Parameterise the branch — the helper currently HARDCODES `work/<slug>`.**
   `RouteToNeedsAttentionOptions` has NO `branch` field today; the helper commits
   on whatever branch `cwd` is on and pushes the hardcoded `work/<slug>`. Add a
   `branch?` field (DEFAULT `work/<slug>` for back-compat) used as the push target —
   and it MUST be the branch the wip/move commits landed on (the cwd's current
   branch). The build path supplies/defaults `work/<slug>`; the seam must NOT assume
   every transition's branch is a build branch — the future PRD-SLICING transition
   uses `work/slicing/<slug>` (per `auto-slice` — its lock is on a different branch
   name so it never collides with build claims).

3. **Push only when the branch CARRIES WORK (emptiness-guarded).** The one genuine
   "nothing to push" case is a couldn't-even-start bounce (no commits beyond main /
   the branch does not exist) — guard the push with the same ahead-of-main check the
   continue-detection uses (`branchAheadOf` in `continue-branch.ts`, or equivalent):
   no work beyond main ⇒ skip the push (no error). NOTE this is a NEW guard the
   helper does not have today (it pushes unconditionally when given an arbiter); the
   move-only commit always makes the branch non-empty in the normal bounce, but the
   guard makes the empty case safe + makes the intent explicit.

4. **Route `run`'s agent-failure THROUGH the seam** (closing the fifth gap as a
   CONSEQUENCE of the design, not a separate patch). `run.ts`'s `agent-failed`
   bare-returns (after prompt-assembly fail / `runAgent` throw / `agent.ok ===
   false`) currently save nothing. Make them call the seam transition (mirroring
   `do.ts`'s `saveAgentFailure`), so the fleet's failed-agent work is saved +
   surfaced + pushed + recoverable — for free, because the push now lives in the
   seam.

5. **Seam intent docstring rewritten as transition-kind-agnostic.** The seam's
   contract becomes *"durably record a stuck job = OBSERVABLE (ledger surface on
   `main`) + RECOVERABLE (push the work branch, when there is one)."* The
   "cherry-pick to `main`" stays a mode-M implementation detail of the OBSERVABLE
   half; "push the work branch" is mode-M's way of satisfying the RECOVERABLE half
   (a future mode-P could satisfy it differently). Crucially the docstring must NOT
   assume a `work/<slug>` build branch — recovery is ARTIFACT-AGNOSTIC.

### What stays put (do NOT absorb)

- The **onboard-time `--force-with-lease` continue-push** (in `start.ts` /
  `isolation.ts` / `workspace.ts`) is a DIFFERENT operation — it rebases-then-pushes
  a CONTINUED branch at onboard time, not a bounce. It stays where it is. This slice
  absorbs ONLY the bounce-time plain push.
- The **continue-rebase-conflict bounces** (§14: `run.ts`'s onboard-time
  continue-conflict, and `start.ts`'s `routeContinueConflict` via the seam) now also
  flow through the always-push seam. This is SAFE, but NOT because of the emptiness
  guard (a continued branch DOES have work beyond main, so it would not be skipped):
  it is safe because the continued branch is ALREADY on the arbiter (from the prior
  requeue), so re-pushing its (un-rebased) tip is a no-op / fast-forward — harmless.
  VERIFY this holds (the local continued tip equals or fast-forwards the arbiter
  tip at bounce time); if a rebase had rewritten it, a plain push could be rejected
  (non-fast-forward) — in which case the best-effort push (step 1) swallows it and
  the branch stays as-is, still recoverable. Either way: do NOT special-case it, but
  state the real reason it is correct (already-on-arbiter), not the emptiness guard.

### Design note carried forward (for `auto-slice`, NOT built here)

§14's recovery model ("the branch is the durable artifact; requeue continues from
its tip") is **transition-kind-agnostic** — it applies to the SLICING branch too. A
slicing attempt can fail AFTER producing slice files (e.g. a `review` Gate-1 spec
rejection), and **those written slices are a valuable durable artifact** — discarding
them re-derives the decomposition from scratch and loses the reviewer's context. So
when PRD-slicing is built (`auto-slice`, currently `prd-not-wired`), it MUST reuse
THIS seam: push its `work/slicing/<slug>` branch on a bounce, so a requeue continues
from the written slices, exactly as a build continues from the code wip. This slice
shapes the seam to RECEIVE that (branch-parameterised, emptiness-guarded,
artifact-agnostic) and records the intent in §14 (addendum) so auto-slice reuses the
code rather than re-discovering the asymmetry a sixth time.

## Acceptance criteria

- [ ] `applyNeedsAttentionTransition` NO LONGER strips the arbiter (`const {arbiter,
      ...move}` removed): the helper's existing push fires through the seam, so a
      seam call with an arbiter both publishes the ledger surface AND pushes the
      work branch. The bolted-on `pushWorkBranch` calls + duplicated helpers in
      `run.ts` and `complete.ts` are DELETED (one home for the push: the helper).
      All existing gate-fail / agent-fail / rebase-conflict recovery tests stay green.
- [ ] The helper's push is BEST-EFFORT (an unreachable arbiter does not throw / does
      not turn a bounce into a hard error) — parity with the bolted-on copies it
      replaces. (It is `gitHard`/throwing today.)
- [ ] `RouteToNeedsAttentionOptions` gains a `branch?` field (DEFAULT `work/<slug>`)
      used as the push target, replacing the hardcoded `work/<slug>`. A test passes
      a non-default branch and asserts THAT branch is pushed.
- [ ] A couldn't-start bounce (branch absent / no work beyond main) pushes NOTHING
      and does not error (NEW emptiness guard — the helper pushes unconditionally
      today).
- [ ] `run`'s agent-failure now routes through the seam (saves + surfaces + pushes),
      cross-machine recoverable via requeue-continue — proven by a test from a FRESH
      clone (mirrors PR #8's `do` agent-fail recovery test). The previously-flaky
      run.test.ts "retains the pi harness record" test is repointed to a path that
      STILL retains after this change (the §14 continue-rebase-conflict path), per
      the note in `run-agent-failure-does-not-save-work.md`.
- [ ] The seam's intent docstring is rewritten transition-kind-agnostic
      (observable + recoverable; no `work/<slug>` assumption); §14 gains a short
      addendum stating recovery covers the slicing branch too (continue-from-written-
      slices), so `auto-slice` reuses this seam.
- [ ] The onboard-time `--force-with-lease` continue-push is UNCHANGED (not absorbed)
      and the HUMAN `complete` path (no `surfaceArbiter`) stays local-only (no push).
- [ ] **Test isolation:** local `--bare` arbiter + temp dirs + stubbed agent (no real
      pi launch); assert real shared dirs untouched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `gate-fail-pushes-work-branch` — this consolidates the pushes that slice landed
  (so it must be merged first; this slice removes its bolted-on duplication).

## Prompt

> Consolidate the recurring "push the work branch on a needs-attention bounce"
> logic INTO the ledger write seam, so it is ONE operation done in ONE place
> (transition-kind-agnostic), instead of bolted onto each caller (we have patched
> this asymmetry FOUR times; a fifth — `run` agent-fail — is still missing).
>
> The push ALREADY EXISTS in `routeToNeedsAttention` (`src/needs-attention.ts`: its
> tail pushes `work/<slug>` when given `arbiter`, hardcoded + throwing) — but the
> SEAM wrapper `applyNeedsAttentionTransition` (`src/ledger-write.ts`) STRIPS the
> arbiter (`const {arbiter, ...move} = input`) so it never fires. THE FIX: (a) stop
> the seam stripping the arbiter so the helper's push fires alongside the
> ledger-surface publish; (b) parameterise the helper's hardcoded branch — add a
> `branch?` field to `RouteToNeedsAttentionOptions` (DEFAULT `work/<slug>`), used as
> the push target (it must be the branch the wip/move commits landed on; do NOT
> assume a build branch — the future PRD-slicing transition uses
> `work/slicing/<slug>`); (c) soften the helper's push to BEST-EFFORT (no throw on
> an unreachable arbiter — parity with the bolted-on copies); (d) add an
> emptiness guard (no work beyond main / branch absent ⇒ skip; reuse `branchAheadOf`
> from `continue-branch.ts`). Then DELETE the bolted-on `pushWorkBranch` calls +
> duplicated helpers in `src/run.ts` (steps 5 + integrate-conflict) and
> `src/complete.ts` (gate-fail + rebase-conflict). Route `src/run.ts`'s
> `agent-failed` returns through the seam (mirror `do.ts`'s `saveAgentFailure`) so
> the fleet's failed-agent work is saved+pushed+recoverable.
>
> Verify the continue-rebase-conflict bounces (`run` onboard-time + `start.ts`
> `routeContinueConflict`) stay correct now that they too always-push: safe because
> the continued branch is already on the arbiter (no-op/ff push), NOT because of the
> emptiness guard — confirm, do not special-case.
>
> Rewrite the seam's intent docstring: "durably record a stuck job = OBSERVABLE
> (ledger surface on main, the mode-M cherry-pick) + RECOVERABLE (push the work
> branch, when there is one)" — transition-kind-agnostic, NO `work/<slug>`
> assumption. Add a short §14 addendum
> (`docs/adr/execution-substrate-decisions.md`): recovery is artifact-agnostic and
> covers the SLICING branch too (a slice attempt that produced slices then failed a
> review keeps them; requeue continues from the written slices) — so `auto-slice`
> (currently `prd-not-wired`) reuses THIS seam rather than re-inventing the push.
>
> READ FIRST: `src/needs-attention.ts` (`routeToNeedsAttention` — its tail ALREADY
> pushes the hardcoded `work/<slug>` when given `arbiter`, via `gitHard`; this is
> the push to parameterise + soften, NOT re-implement); `src/ledger-write.ts`
> (`applyNeedsAttentionTransition` — the `const {arbiter, ...move} = input` strip
> that WITHHOLDS that push is the root bug); `src/run.ts` (steps 5 +
> integrate-conflict push + the `agent-failed` bare-returns); `src/complete.ts`
> (gate-fail + rebase-conflict push + the `pushWorkBranch` helper); `src/do.ts`
> (`saveAgentFailure` — the parity reference); `src/continue-branch.ts`
> (`branchAheadOf` for the emptiness guard); `work/observations/needs-attention-seam-*.md`
> + `run-agent-failure-does-not-save-work.md`; `work/prd/auto-slice.md` (the slicing
> branch `work/slicing/<slug>` + lock — why the branch must not be hardcoded);
> `docs/adr/execution-substrate-decisions.md` §14. Do NOT absorb the onboard-time
> `--force-with-lease` continue-push (different operation). Keep the human
> `complete` (no surfaceArbiter) local-only.
>
> TDD with vitest, house style (local `--bare` arbiter, temp dirs, stubbed agent):
> the seam pushes the supplied branch when it has work + skips when empty; run's
> agent-fail saves+pushes (fresh-clone requeue-continue recovers it); all existing
> recovery tests stay green; the onboard-time continue-push + human-complete paths
> are untouched. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim centralise-bounce-branch-push --arbiter <remote>
git fetch <remote> && git switch -c work/centralise-bounce-branch-push <remote>/main
git mv work/in-progress/centralise-bounce-branch-push.md work/done/centralise-bounce-branch-push.md
```
