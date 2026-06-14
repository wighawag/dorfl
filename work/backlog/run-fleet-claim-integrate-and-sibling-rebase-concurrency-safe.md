---
title: 'run-fleet-claim-integrate-and-sibling-rebase-concurrency-safe: close the two pre-existing run-fleet same-repo concurrency races (claim-vs-integrate non-fast-forward push, and sibling-slug divergent-base ledger rebase conflict) so run can run same-repo jobs in parallel (perRepoMax>1) safely, unlocking the fresh-worktree gate default-ON on the run fleet too'
slug: run-fleet-claim-integrate-and-sibling-rebase-concurrency-safe
blockedBy: []
covers: []
---

> Self-contained CONCURRENCY-CORRECTNESS slice. It derives from NO PRD (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth.
>
> Source signal: the re-drive STOP of `gate-on-rebased-tip-fresh-worktree` (2026-06-14), whose claims the maintainer VERIFIED against the code. The fresh-worktree-gate slice landed default-ON for the single-job paths and for `run` at `perRepoMax === 1`, deliberately downgrading `run` to today's gate at `perRepoMax > 1` to AVOID these two races. This slice fixes the races on their own merits so that downgrade can later be removed (the fresh gate then works on the `run` fleet at any `perRepoMax`). These two races are PRE-EXISTING in `run` today (timing-hidden), independent of the gate; they only fire under same-repo fleet concurrency (`perRepoMax > 1`, default 2).

## What to build

Close the two same-repo `run`-fleet concurrency races so two jobs of the SAME repo can integrate in parallel deterministically. Verify both against current code before building:

### Race 1: CLAIM-vs-INTEGRATE non-fast-forward push

`run` serialises the CLAIM and the INTEGRATE TAIL under SEPARATE `createKeyedLock` instances (`src/run.ts` ~L307 `claimLock`, ~L321 `integrateLock`, both keyed per repo but DISTINCT locks). So while job A holds the integrate lock and is mid-push, a sibling same-repo job B can take the CLAIM lock and advance `<arbiter>/main` (the claim is a CAS commit to main). Job A's merge push is a PLAIN non-retried `${branch}:main` (`src/integrator.ts` `integrate`, merge branch: no `--force-with-lease`, no retry), so A's push is then rejected non-fast-forward. Today this is hidden by benign timing; the fresh gate's added latency makes it deterministic.

Fix options (decide + record in `## Decisions`):
- (a) A bounded re-rebase-and-retry on a non-fast-forward `${branch}:main` push: on rejection, re-fetch `<arbiter>/main`, rebase the work branch onto it, and retry the push up to a small cap; a genuine code conflict on the re-rebase routes to needs-attention (rebase-conflict). NOTE: this would make `integration-core`'s "WITHOUT the lock, two same-base concurrent merges do NOT both cleanly land" control test (added by `run-merge-integration-concurrency-safe`, #122) BOTH-LAND, so that control test must be updated to reflect the new retry contract.
- (b) Widen the per-repo serialisation so a claim cannot advance main inside another job's integrate window (e.g. the claim and integrate share ONE per-repo lock, or the integrate re-checks/rebases under the integrate lock against the freshly-fetched main right before the push). Record the chosen approach and why.

### Race 2: SIBLING-SLUG divergent-base ledger rebase conflict

In the job-worktree/bare-mirror harness, a job's clean single commit (e.g. `feat(a): a; done` touching only `a.txt` + the `work/{in-progress => done}/a.md` move) can CONFLICT during the step-4 `git rebase <arbiter>/main` on ANOTHER slug's `work/done/b.md` (a sibling job that landed its done-move between the base and the rebase). `reconcileDivergentDoneMove` (`src/integration-core.ts` ~L1768) only recovers the OWN slug's divergent placement (it reads `readArbiterLedgerPlacement(cwd, arbiter, slug, env)` for THIS slug), so a sibling-slug ledger conflict is not auto-recovered and the job routes to needs-attention even though there is no real code conflict.

Fix (decide + record): make the step-4 ledger rebase recover the sibling-slug divergent-base case too: a conflict that is PURELY in another slug's `work/<status>/<otherslug>.md` ledger file (a different slug's status-folder move, never a code file and never THIS slug's ledger) is a benign ledger-only divergence that should be reconciled (take the arbiter's version of the sibling's ledger file and continue the rebase), NOT routed to needs-attention. A conflict touching any code file, or THIS slug's own ledger, stays a genuine conflict and routes to needs-attention as today. Generalise `reconcileDivergentDoneMove` (or add a sibling-ledger-conflict arm) so it is scoped to "conflicts confined to OTHER slugs' ledger files", never widening to code.

### Then: re-enable the fresh gate on the run fleet

Once both races are closed and the concurrent-`run` tests prove same-repo parallel merges land deterministically, REMOVE the `perRepoMax === 1` downgrade in the `run` caller. UPDATE (2026-06-14): `gate-on-rebased-tip-fresh-worktree` is now MERGED (#125), so the downgrade DEFINITELY EXISTS and removing it is MANDATORY (not conditional). It is at `src/run.ts` ~L882: `freshWorktreeGate: config.freshWorktreeGate && config.perRepoMax === 1` (find it by the `perRepoMax === 1` text; the line may shift). Change it to pass the resolved `config.freshWorktreeGate` UNCONDITIONALLY (drop the `&& config.perRepoMax === 1`), so the fresh rebased-tip gate runs on the `run` fleet at ANY `perRepoMax`. This is THE deferred concern this slice exists to close: the run daemon's same-repo-parallel concurrency. It is NOT done until that downgrade is gone AND a concurrent-`run`-at-`perRepoMax: 2` test with the fresh gate ON proves both same-repo jobs land.

## Acceptance criteria

- [ ] Race 1 closed: two CONCURRENT same-repo jobs where one CLAIMS while the other INTEGRATES (merge mode) both land deterministically (the integrator survives a sibling claim advancing main during its push window), via the chosen fix. A genuine code conflict still routes one to needs-attention. Tested deterministically (drive at the level where the claim-vs-integrate interleave is controllable, mirroring the `integration-core` concurrency tests #122 added).
- [ ] If the bounded-retry fix is chosen: the `integration-core` "WITHOUT the lock, two same-base concurrent merges do NOT both cleanly land" control test is updated to the new retry contract (it now both-lands), with the change explained in `## Decisions`.
- [ ] Race 2 closed: a step-4 rebase conflict confined PURELY to ANOTHER slug's `work/<status>/<otherslug>.md` ledger file is reconciled (arbiter's sibling-ledger version taken, rebase continues, the job lands), NOT routed to needs-attention. A conflict touching any CODE file or THIS slug's own ledger still routes to needs-attention (no widening to code). Tested both ways.
- [ ] `reconcileDivergentDoneMove` (or the new sibling-ledger arm) stays strictly scoped to other-slug ledger files; it NEVER auto-resolves a code conflict. Verified by a test that a code conflict is still surfaced.
- [ ] The existing concurrent-`run` / `run-loop` / `advance` outcome-equivalence tests stay green (updated only where the new deterministic both-land contract requires, with each change explained).
- [ ] MANDATORY (gate-on-rebased-tip-fresh-worktree is MERGED, #125): the `perRepoMax === 1` downgrade in the `run` caller (`src/run.ts` ~L882, `config.freshWorktreeGate && config.perRepoMax === 1`) is REMOVED so the fresh rebased-tip gate runs on the `run` fleet at ANY `perRepoMax` (pass the resolved `config.freshWorktreeGate` unconditionally). This is the deferred concern (the run daemon's same-repo-parallel concurrency) and is NOT optional. PROVEN by a concurrent-`run`-at-`perRepoMax: 2` test with the fresh gate ON in which TWO same-repo jobs both land deterministically (the rebased-tip gate AND the integration both survive same-repo parallelism). There is no "defer" escape hatch: the downgrade exists and must go.
- [ ] Tests use their OWN throwaway temp fixtures: NO shared/global location is written (no real home/config dir, no user-level git config), per-run scratch points at a temp dir.
- [ ] A `## Decisions` block records: the Race-1 fix chosen (bounded re-rebase-retry vs shared/extended per-repo lock) and why; the Race-2 sibling-ledger reconciliation scope (other-slug ledger only, never code); and the fresh-gate run-fleet re-enable (done or deferred).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green (note: `format:check` is ROOT-only, NOT `-r`).

## Blocked by

- None; can start immediately. `gate-on-rebased-tip-fresh-worktree` is already MERGED (#125), so its `perRepoMax === 1` downgrade exists and removing it is a MANDATORY part of this slice (not conditional).

## Decisions (to record while building)

- **Race-1 fix.** Bounded re-rebase-and-retry on a non-fast-forward `${branch}:main` push, vs sharing/extending the per-repo lock so a claim cannot advance main inside an integrate window. Record the choice, the rejected alternative, and (if retry) the cap + the control-test update.
- **Race-2 scope.** The sibling-ledger reconciliation is scoped STRICTLY to conflicts confined to OTHER slugs' `work/<status>/<slug>.md` files; any code-file conflict or own-ledger conflict stays a genuine needs-attention route. Record why this cannot widen to code.
- **Fresh-gate run-fleet re-enable (MANDATORY).** Record that the `perRepoMax === 1` downgrade (`src/run.ts` ~L882, added by #125) was REMOVED (the gate slice is merged), so the fresh rebased-tip gate now runs on the `run` fleet at any `perRepoMax`. This is the whole deferred concern; there is no defer option.

## Prompt

> Close the two PRE-EXISTING same-repo `run`-fleet concurrency races so two jobs of the SAME repo can integrate in parallel (`perRepoMax > 1`) deterministically. Both are latent in `run` today (timing-hidden), independent of the fresh-worktree gate; the gate's added latency just makes them deterministic. RACE 1 (claim-vs-integrate): `run` serialises CLAIM and INTEGRATE under SEPARATE per-repo `createKeyedLock`s (`src/run.ts` ~L307 `claimLock`, ~L321 `integrateLock`), so a sibling CLAIM can advance `<arbiter>/main` during a job's integrate push window, and the merge push is a PLAIN non-retried `${branch}:main` (`src/integrator.ts` `integrate`, merge branch), so the push is rejected non-fast-forward. RACE 2 (sibling-slug ledger rebase): the step-4 `git rebase <arbiter>/main` can conflict on ANOTHER slug's `work/done/<otherslug>.md`, and `reconcileDivergentDoneMove` (`src/integration-core.ts` ~L1768) only recovers THIS slug's divergent placement, so a benign sibling-ledger divergence wrongly routes to needs-attention.
>
> BUILD: (Race 1) either a bounded re-rebase-and-retry on a non-fast-forward `${branch}:main` push (re-fetch + rebase + retry up to a cap; a genuine code conflict on the re-rebase routes to needs-attention) OR extend/share the per-repo lock so a claim cannot advance main inside an integrate window. If you choose retry, UPDATE the `integration-core` "WITHOUT the lock, two same-base concurrent merges do NOT both cleanly land" control test (added by #122) to the new both-land retry contract. (Race 2) make the step-4 ledger rebase reconcile a conflict confined PURELY to OTHER slugs' `work/<status>/<otherslug>.md` ledger files (take the arbiter's sibling-ledger version, continue the rebase); a conflict touching any CODE file or THIS slug's own ledger STILL routes to needs-attention (never widen to code). Generalise `reconcileDivergentDoneMove` or add a sibling-ledger arm. THEN (MANDATORY, the gate slice is MERGED #125) REMOVE the `perRepoMax === 1` downgrade in the `run` caller (`src/run.ts` ~L882, `config.freshWorktreeGate && config.perRepoMax === 1`): pass the resolved `config.freshWorktreeGate` UNCONDITIONALLY so the fresh rebased-tip gate runs on the `run` fleet at ANY `perRepoMax`. Prove it with a concurrent-`run`-at-`perRepoMax: 2` test, fresh gate ON, in which both same-repo jobs land. This is the deferred concern (the run daemon's same-repo-parallel concurrency) the whole slice exists to close; it is not optional.
>
> RECORD a `## Decisions` block: the Race-1 fix chosen + why (+ control-test update if retry); the Race-2 sibling-ledger scope (other-slug ledger only, never code); and that the `perRepoMax === 1` fresh-gate downgrade was REMOVED so the fresh gate runs on the run fleet at any parallelism (mandatory; the gate slice #125 is merged).
>
> READ FIRST (and DRIFT-CHECK every claim by SYMBOL; line numbers shifted after #125 merged the fresh-worktree gate): `src/run.ts` (`claimLock` ~L347 + `integrateLock` ~L361 (SEPARATE locks), the `performIntegration` call ~L900, the `freshWorktreeGate: config.freshWorktreeGate && config.perRepoMax === 1` downgrade ~L882 to REMOVE, the per-repo `resolveRepoConfig`/`config.perRepoMax`); `src/integrator.ts` (`Integrator.integrate`, merge branch, the plain `${branch}:main` push ~L325); `src/integration-core.ts` (the step-4 rebase, `reconcileDivergentDoneMove` ~L1872 + `readArbiterLedgerPlacement(cwd, arbiter, slug, env)` ~L1892 (own-slug-scoped), and the fresh-gate band now lands the verify+review on the rebased tip so be careful the run-fleet gate path is exercised at perRepoMax 2); `test/integration-core.test.ts` (the #122 concurrency + lock-control tests), `test/run.test.ts`, `test/run-loop.test.ts`, `test/advance-registry-set.test.ts`, `test/run-uses-advance-tick.test.ts` (the concurrent-run contracts to keep green / update); the `gate-on-rebased-tip-fresh-worktree` slice (for the `perRepoMax === 1` downgrade to remove). DRIFT-CHECK: confirm the claim and integrate are still SEPARATE locks and the merge push is still plain non-retried; if a prior slice already merged these, route to needs-attention with the discrepancy.
>
> SCOPE FENCE: do NOT widen the ledger reconciliation to code conflicts (other-slug ledger files ONLY); do NOT force-push main (the retry re-rebases then pushes a clean fast-forward, never `--force` on main); do NOT change the single-job paths (they have no fleet concurrency); keep cross-repo concurrency untouched. "Done" = both races closed (concurrent same-repo claim-vs-integrate both land; sibling-ledger rebase reconciles while code conflicts still surface), the concurrency tests are green (updated where the new deterministic contract requires, each explained), the fresh-gate run-fleet downgrade is removed (or deferral recorded), the Decisions block is recorded, and `pnpm -r build && pnpm -r test && pnpm format:check` is green.
>
> FIRST, check this slice against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `done/` and current `src/run.ts`/`src/integrator.ts`/`src/integration-core.ts`? If the races are already fixed, do NOT build on the stale premise; route to `needs-attention/` with the discrepancy (WORK-CONTRACT.md "Drift is a needs-attention signal").

---

### Claiming this slice

```sh
agent-runner claim run-fleet-claim-integrate-and-sibling-rebase-concurrency-safe --arbiter origin
git fetch origin && git switch -c work/run-fleet-claim-integrate-and-sibling-rebase-concurrency-safe origin/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/run-fleet-claim-integrate-and-sibling-rebase-concurrency-safe.md work/done/run-fleet-claim-integrate-and-sibling-rebase-concurrency-safe.md
```
