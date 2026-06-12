---
title: a first-class verb to recover GREEN-BUT-UNINTEGRATED work (built + committed in a job worktree, but the PR/integration step failed) — open its PR from the existing branch, never a hand-rebuild-and-force-push
slug: recover-stranded-green-work
needsAnswers: true
blockedBy: []
covers: []
---

## What to build

A first-class runner path to recover a build whose WORK is green and COMMITTED but whose INTEGRATION did not complete — the residual "stranded green work" case: `do` ran the build agent, the gate passed, the commit was made in the job worktree, but the PR/branch push (or the propose/merge step) then failed terminally. Today there is no clean verb for "this branch already holds green, gate-passed work — just open its PR / integrate it from where it is." The operator is forced into a manual **rebuild-a-clean-branch-off-main + force-push** dance.

### Why this is its own gap (and not closed by the stale-lease retry)

`work-branch-push-retry-on-stale-lease` (#88) made the stranding RARER — the continue-branch push now re-fetches + re-rebases + retries on a stale lease instead of failing on the first rejection. But it did NOT add a RECOVERY path for when integration still fails terminally (retry cap exhausted, a non-stale push failure, a propose-step `gh` failure, an interrupted `do`). In all those cases the green commit sits in the job worktree (e.g. `~/.agent-runner/work/<encoded>/...`) and the item is in `needs-attention/`, recoverable only by hand.

The existing recovery verbs don't cover it cleanly:

- `requeue` (keep+continue) + re-`do` REBUILDS from the kept branch's tip — correct when the work needs more building, WASTEFUL when the work is already green and only the PR is missing (it re-runs the whole build agent + gate).
- `resume` / `complete` operate "in the CURRENT checkout" on a `work/<slug>` branch. The stranded commit is in a JOB WORKTREE (the agents' area, isolated/`--remote` builds), which is reaped/foreign to the human checkout — so there is no in-checkout branch to `resume` onto without first reconstructing it by hand.

### The observed incident (the motivating evidence)

`advance-verb-resolver` built green (1467 tests, Gate-2 approved, commit `64b9501` in the job worktree) but the `--force-with-lease` push failed ("stale info"); the origin tip stayed the stale `f75ff55`, no PR opened. Recovery was a hand-driven `git switch -C work/<slug> origin/main` + re-applying the files from the commit object + re-running the gate + force-pushing — the EXACT manual dance this slice should make a verb. (And note: `drive-backlog`'s own golden-rule sidebar WARNS that spinning a parallel branch off main and re-applying the tree ORPHANS the canonical `work/<slug>` branch on the remote — so the manual dance is not just tedious, it is the anti-pattern the skill explicitly cautions against.)

### Shape (to confirm — see Open questions)

The likely-right shape: a verb (or a flag on an existing one) that, given a slug whose green commit is on the `work/<slug>` branch (in a job worktree OR already on the arbiter), **integrates from that existing branch** — reuse the SAME `performIntegration` / `integration-core` tail `do`/`complete` use (rebase-onto-main if needed → propose=open PR / merge=land), with NO rebuild, NO orphan branch, NEVER `--force` to main. It should be idempotent (safe to re-run) and detect "already integrated" as a clean no-op.

## Open questions (resolve before building — this is why `needsAnswers: true`)

1. **New verb vs. flag on an existing one.** Is this a new verb (e.g. `integrate <slug>` / `land <slug>` / `recover <slug>`), or a mode of `complete` (e.g. `complete --from-worktree` / `complete --no-rebuild`), or a `requeue` sibling? It must NOT re-run the build agent + gate, which is the line that separates it from `requeue`+`do`.
2. **Finding the green commit.** How does the verb locate the green commit when the job worktree was REAPED (the common case — `do` reaps on exit)? Does recovery require the branch to be on the ARBITER (so a reaped worktree is fine because the branch was pushed), or must it also handle "committed locally in a since-removed worktree, never pushed" (the `64b9501` case — the push FAILED, so the branch tip is ONLY in the worktree)? This is the crux: if the worktree is gone and the push failed, the commit may be unreachable except via reflog/dangling — does the verb guarantee the worktree is KEPT on integration-failure (so recovery always has a source), rather than reaped?
3. **Does `do` change on integration-failure?** A cleaner fix may be upstream: when `do`'s build is green but integration fails, DON'T reap the job worktree, and emit a precise "recover with `<verb> <slug>`" instruction (the worktree + branch are the recovery source). Is the fix "keep the worktree + add a recovery verb", or "push the branch on green BEFORE attempting the PR so the arbiter always has it" (making the branch the durable artifact, worktree reapable)?
4. **Gate re-run policy.** The work was already gate-passed in the worktree, but against the worktree's tree, not necessarily the rebased-onto-current-main tree (the known Gate-1-vs-pushed-branch divergence, `gate1-could-run-in-fresh-worktree-...`). Does recovery RE-run the gate after a recovery-time rebase, or trust the prior green? (Cheap-but-maybe-stale vs slow-but-honest.)
5. **Relationship to `--propose` vs `--merge`.** Recovery should honour the same integration-mode resolution. Confirm it routes through `performIntegration` so mode/arbiter args resolve once, identically to `do`/`complete`.

## Acceptance criteria (subject to the answers above)

- [ ] A green-but-unintegrated item can be integrated FROM ITS EXISTING `work/<slug>` branch with NO rebuild of the build agent and NO gate re-run of the agent's work (gate re-run policy per Q4), via the SAME `performIntegration`/`integration-core` tail (rebase→propose/merge).
- [ ] The recovery NEVER creates a parallel/orphan branch off main and NEVER `--force`es to main; it integrates the canonical `work/<slug>` branch in place.
- [ ] Recovery is idempotent: re-running after a successful integration is a clean no-op ("already integrated"), not a duplicate PR / error.
- [ ] The green commit is reliably LOCATABLE on integration-failure (per Q2/Q3 — the worktree is kept, or the branch is pushed-on-green, so recovery always has a source); a build that goes green never becomes unrecoverable.
- [ ] `do`'s integration-failure path emits a precise, copy-pasteable recovery instruction naming the verb + slug.
- [ ] Tests reproduce "green build, integration fails" in a throwaway-git fixture and assert recovery opens the PR / lands the work from the existing branch (no rebuild, no orphan branch, no `--force` to main); plus the idempotent re-run no-op.
- [ ] No shared/global location touched outside temp fixtures.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None to START the design conversation — but it is `needsAnswers: true`: the open questions (especially Q2/Q3 — worktree-reaped-vs-kept and where the durable commit lives) must be resolved by a human before building, because they decide the whole shape.

## Prompt

> DO NOT BUILD YET — this slice is `needsAnswers: true`. First resolve the Open questions in the body (the verb-vs-flag choice, and crucially how the green commit is located when the job worktree is reaped and/or the push failed — Q2/Q3). Building before those are answered risks the wrong shape (e.g. a recovery verb that can't find the commit it's meant to recover).
>
> The goal: a first-class path to integrate GREEN-BUT-UNINTEGRATED work (built + gate-passed + committed, but the PR/integration step failed) from its EXISTING `work/<slug>` branch — reusing `performIntegration`/`integration-core` (rebase→propose/merge), with NO rebuild of the build agent, NO orphan branch off main, NEVER `--force` to main. It replaces the manual rebuild-and-force-push dance the `advance-verb-resolver` incident required (commit `64b9501` stranded in the job worktree after a failed push).
>
> READ FIRST: `packages/agent-runner/src/integration-core.ts` (`performIntegration` — the shared rebase→integrate tail `do`/`complete` reuse), `packages/agent-runner/src/complete.ts` (the in-checkout completion path), `packages/agent-runner/src/do.ts` + `workspace.ts` (the job-worktree lifecycle + where it reaps), `packages/agent-runner/src/continue-branch.ts` (`pushContinuedBranchWithStaleLeaseRetry` — the #88 retry that made stranding rarer but not impossible), and the observations `work/observations/drive-backlog-skill-assumes-in-place-do-not-remote.md` + `gate1-could-run-in-fresh-worktree-to-match-pushed-branch.md`. Also re-read `drive-backlog`'s golden-rule sidebar on why a parallel `pr/<slug>` branch orphans the canonical `work/<slug>`.
>
> FIRST, check this slice against current reality (drift): confirm the job-worktree reap behaviour, the `do` integration-failure path, and whether #88's retry already keeps the worktree or pushes-on-green. Reconcile the Open questions against what the code ACTUALLY does now, then propose the shape for human ratification before building.
>
> TDD with vitest, house style (throwaway git repos). "Done" = the answered open questions are reflected, the acceptance criteria met, and the gate green.

---

### Claiming this slice

```sh
agent-runner claim recover-stranded-green-work --arbiter origin
git fetch origin && git switch -c work/recover-stranded-green-work origin/main
git mv work/in-progress/recover-stranded-green-work.md work/done/recover-stranded-green-work.md
```
