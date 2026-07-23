---
title: 'isolation-strategy-seam — in-place vs job-worktree isolation seam that `do` selects on'
slug: isolation-strategy-seam
spec: command-surface-phase-2
blockedBy: []
covers: [6]
---

## What to build

The **isolation-strategy seam** the `do` worker selects on (ADR §3): one seam, two strategies, chosen by whether there is a checkout.

- **In-place strategy** — used when `do` has a checkout (the checkout / CI container IS the isolation): claim + build + gate + integrate operate directly in the current working tree on its `work/<slug>` branch. NO hub mirror, NO external worktree.
- **Job-worktree strategy** — used by `do --remote` (no checkout) AND by `run`: materialise a hub mirror + an external job worktree in the **agents' area** (`workspacesDir`), exactly as `run`'s current `createJob` path does (ADR §1/§2).

This slice is a **pure seam extraction**, NOT a new command. Factor the isolation-acquisition + cleanup that `run.ts`/`workspace.ts` already perform for the job-worktree case behind a small interface (e.g. "prepare an isolated working tree for slug on a freshly-fetched main; tear it down per the §4 deletion predicate"), and add the in-place strategy as the second implementor.

**The seam must produce a UNIFORM HANDLE the pipeline reads from — this is the load-bearing design constraint, not an afterthought.** Today `run.ts`'s pipeline (the private `runOneItem`) is hard-wired to the `Job` shape from `createJob`: it reads `job.dir`, `job.branch`, `job.arbiterRemote`, `job.mirror.url`, and calls `reapJob(...)` at the end — ALL of which assume a job worktree + hub mirror. For `do-in-place` to reuse that pipeline against the CURRENT CHECKOUT, the seam must yield the same handle fields for BOTH strategies:

- `dir` (the working tree: the job worktree, or the current checkout),
- `branch` (`work/<slug>`),
- the arbiter remote NAME to push to (in-place: the checkout's arbiter remote; job-worktree: the mirror clone's `origin`),
- the arbiter URL used for provider auto-detection (`job.mirror.url` today — in the in-place case, the checkout's arbiter remote URL),
- a teardown that does the right thing per strategy (job-worktree: `reapJob` / the §4 predicate; in-place: leave the checkout in a defined state, do NOT reap). So: extract `runOneItem` (or the post-claim build→gate→done-move→rebase→integrate→ teardown body) so it operates on this handle + a strategy, NOT on a concrete `Job`. The seam's signatures stay SEMANTIC (prepare/teardown an isolated tree + expose the handle) and must not assume WHERE the tree lives, so `do-in-place` and `do-remote`/`run` each select their strategy without the pipeline knowing.

Observable behaviour of `run` must be **byte-identical** after the extraction (the job-worktree strategy IS today's behaviour); the in-place strategy is new but is not wired to any command in this slice (that is `do-in-place`).

**Be aware of the OTHER existing in-place path before you design the seam.** The human verbs `start` (claim + switch to `work/<slug>`, dirty-tree-aware) and `complete` (gate + done-move + rebase + integrate + branch tidy) ALREADY operate in-place on a checkout — `do-in-place` is expected to COMPOSE them (plus an autonomous harness run) rather than re-derive the lifecycle from `runOneItem`. So the in-place "strategy" may be thinner than the job-worktree one (the checkout is the tree; `start`/`complete` already do the branch + integrate steps). Design the seam/handle so it does not FORCE the in-place case through `runOneItem`'s job-shaped flow if composing `start`/`complete` is cleaner — the seam's job is to remove the `Job`-shape assumption from the shared steps, not to mandate one pipeline. The uniform handle below is what lets EITHER consumer drive the shared post-claim steps.

## Acceptance criteria

- [ ] A seam exists with two strategies: in-place (operate in the current checkout) and job-worktree (hub mirror + external worktree in the agents' area).
- [ ] The job-worktree strategy is the EXISTING `run` isolation, extracted behind the seam; `run`'s observable behaviour is unchanged (its tests pass).
- [ ] The in-place strategy prepares/operates-in/cleans-up the current checkout's `work/<slug>` branch without a hub mirror or external worktree.
- [ ] Teardown re-applies the §4 deletion-safety predicate for the job-worktree strategy (unchanged); the in-place strategy leaves the human's checkout in a defined state (documented in the slice's tests).
- [ ] The seam produces a UNIFORM HANDLE (working dir, `work/<slug>` branch, arbiter remote name, arbiter URL for provider detection, strategy-appropriate teardown) that BOTH strategies satisfy; the post-claim pipeline (build→gate→done-move→rebase→integrate→teardown) reads from that handle, not from a concrete `Job`, so it can run against either strategy.
- [ ] The seam is selected by "is there a checkout", not hardcoded; no command is rewired to the in-place strategy in THIS slice.
- [ ] Tests cover both strategies (job-worktree against a local `--bare` arbiter as `run` does; in-place against a throwaway checkout) at the seam.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — a pure seam extraction; `do-in-place`/`do-remote` consume it.

## Prompt

> Extract an **isolation-strategy seam** with two strategies — in-place (operate in the current checkout) and job-worktree (hub mirror + external worktree in the agents' area) — per `docs/adr/command-surface-and-journeys.md` §3 and the substrate ADR §1/§2/§4. PURE seam extraction: `run`'s observable behaviour must be byte-identical (the job-worktree strategy IS today's `run` isolation). Wire NO command to the in-place strategy here (that is the `do-in-place` slice).
>
> FIRST run the drift check: confirm `run.ts`'s `createJob`/`runOneItem` isolation + end-of-job `reapJob`, and `workspace.ts`'s job creation, still match this slice's assumptions; if a sibling slice changed the seam, route to needs-attention (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> READ FIRST: ADR `command-surface-and-journeys` §2/§3 (storage areas map onto the doer axis; in-place vs job-worktree), `docs/adr/execution-substrate-decisions.md` §1/§2/§4 (jobs, hub-mirror+worktree isolation, the provably-safe deletion predicate), `src/run.ts` (`createJob`, `runOneItem`, the `reapJob` teardown), `src/workspace.ts` (job records + worktree), `src/repo-mirror.ts` (the mirror primitive).
>
> Factor isolation acquisition + teardown behind a small SEMANTIC interface (prepare an isolated tree for a slug on freshly-fetched main; expose a uniform handle; tear it down) with the job-worktree case as one implementor (extracted, unchanged) and an in-place implementor as the second. Select by "is there a checkout", not a hardcoded path.
>
> CRITICAL design constraint: `run.ts`'s pipeline (`runOneItem`) currently reads a concrete `Job` (`job.dir`/`job.branch`/`job.arbiterRemote`/`job.mirror.url`) and calls `reapJob`. For `do-in-place` to reuse this pipeline against the current checkout, the seam must produce a UNIFORM HANDLE with those same fields for BOTH strategies (in-place: the checkout's dir + its arbiter remote/URL + a no-reap teardown; job-worktree: today's `Job` + `reapJob`). Extract the post-claim pipeline body to operate on that handle + strategy, not a concrete `Job`. Do NOT rewire any command to the in-place strategy in THIS slice (that is `do-in-place`).
>
> TDD with vitest, house style: job-worktree strategy against a local `--bare` arbiter (as `run` tests do); in-place strategy against a throwaway checkout. Prove `run` is unchanged. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim isolation-strategy-seam --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/isolation-strategy-seam <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/isolation-strategy-seam.md work/done/isolation-strategy-seam.md
```
