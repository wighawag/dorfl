---
title: agent workspaces — hub mirrors + isolated job worktrees, with seams, gc, status
slug: agent-workspaces
prd: agent-runner
afk: false
blocked_by: [run-once]
covers: [5, 6, 10, 12]
created: 2026-06-03
claimed_by:
claimed_at:
---

## What to build

The execution substrate that replaces `run-once`'s ad-hoc "worktree or clone"
isolation with a real, reusable mechanism: per-repo hub mirrors + per-job
isolated worktrees, plus the seams (harness, integration) and lifecycle (status,
provably-safe deletion, gc) the runner needs. See the design ADR at
`work/findings/execution-substrate-decisions.md` — it is the source of truth for
every decision below; this slice implements §2–§6.

End-to-end:

- **Workspace layout** under `~/.agent-runner/` (config `workspacesDir`; treated
  as STATE, never housed in a cache dir — ADR §3):
  - `repos/<host>/<org>/<name>.git` — one bare hub mirror per repo (hierarchical
    key; `.`→`-` per segment, e.g. `github-com`).
  - `work/<work-id>/` — one worktree per job (flat work-id
    `<host-...>__<org>__<name>__<slug>`), checked out OUTSIDE the hub on branch
    `work/<slug>`.
  - `work/<work-id>/.agent-runner-job.json` — job record: slug, repoKey, branch,
    startedAt, state, and a harness block.
- **Repo→key encoding** (ADR §2): deterministic function from arbiter URL to the
  hierarchical hub key and the flat work-id.
- **Create a job workspace**: ensure the hub mirror (clone --bare / fetch), then
  `git worktree add work/<work-id> -b work/<slug> <hub>/main`.
- **Harness seam** (ADR §5): a small interface for launching a job's command and
  reporting liveness. Ship a **null adapter** (records PID, runs a configured
  command) so this slice is testable standalone. (The pi adapter is its own
  slice.) Liveness comes from the harness — never from filesystem mtime.
- **Integration seam** (ADR §6): an `Integrator` with the two modes — `merge`
  (ff/rebase onto `<arbiter>/main`, push to main) and **`propose`** (push the
  branch + request review via a provider seam). Ship the provider-agnostic part
  + a **`none` provider** (push branch, print "open a request manually"); the
  `github`/`gh` provider is its own slice. The safety-bearing action is the
  `git push`.
- **Provably-safe deletion** (ADR §4): remove a job worktree (via
  `git worktree remove` + prune) iff working tree is clean AND the branch tip is
  reachable on the arbiter (merged-ancestor of `<arbiter>/main`, OR pushed branch
  with remote-tip == local-tip). Auto-delete at end-of-job when the predicate
  holds; otherwise retain.
- **`agent-runner gc`**: re-apply the deletion predicate to every `work/*/`,
  reaping the provably-safe and reporting each retained one with a reason.
  `--force` overrides (loud; never default).
- **`agent-runner status`** (separate from `scan` — ADR: scan is the backlog
  queue, status is live jobs): list active / failed / retained jobs from
  `work/*/` + their job records, with harness liveness.
- **Refactor `run-once`** to create/claim/run/integrate via this substrate
  instead of its own isolation (ADR §1 jobs-not-agents).

## Acceptance criteria

- [ ] Hub mirror created once per repo and reused (fetch, not re-clone) across
      jobs; lives under `~/.agent-runner/repos/<host>/<org>/<name>.git`.
- [ ] Each job runs in its own worktree at `~/.agent-runner/work/<work-id>/` on
      branch `work/<slug>`; two jobs never share a working tree; distinct slugs ⇒
      distinct branches (no same-branch worktree collision).
- [ ] Repo→key encoding is deterministic and `.`→`-` per segment (`github-com`),
      hierarchical for hubs, flat for work-ids; unit-tested.
- [ ] Harness seam exists with a working null adapter; liveness reported by the
      harness (not mtime).
- [ ] Integration seam exists with `merge` and `propose` modes and a `none`
      provider; `propose` pushes the branch; never `--force` to main.
- [ ] Deletion predicate enforced: a worktree is removed only when clean AND its
      tip is on the arbiter; otherwise retained. Unit/integration-tested against a
      local `--bare` arbiter for both branches of the predicate.
- [ ] `gc` reaps provably-safe jobs and reports retained ones with reasons;
      `--force` documented and gated.
- [ ] `status` lists active/failed/retained jobs distinctly from `scan`.
- [ ] `run-once` is refactored to use this substrate (no second isolation path).
- [ ] Tests use throwaway git repos + a local `--bare` arbiter (mirror the
      `claim.sh` verification approach).

## Blocked by

- `run-once` — this refactors run-once's execution onto the new substrate.

## Prompt

> Build the execution substrate for `agent-runner` (package `packages/agent-runner/`).
> READ FIRST: `work/findings/execution-substrate-decisions.md` (the ADR) — it is
> the authoritative design for everything here (§2 isolation, §3 state-not-cache,
> §4 deletion predicate, §5 harness seam, §6 integration seam). Also read
> `work/prd/agent-runner.md` and the existing `run-once` implementation/tests.
>
> Implement: a workspace manager that maintains per-repo bare hub mirrors and
> per-job git worktrees (checked out outside the hub) under `~/.agent-runner/`
> (config `workspacesDir`); a deterministic repo→key encoding (hierarchical hub
> key, flat work-id, `.`→`-` per segment); a per-job record file; a **harness
> seam** with a null adapter (PID + configured command; liveness from the harness,
> not mtime); an **integration seam** with `merge` and `propose` modes and a
> `none` provider (push-only) — the `github`/`gh` provider is a separate slice;
> provably-safe deletion (clean tree AND branch tip reachable on the arbiter, via
> `git merge-base --is-ancestor` or remote-tip==local-tip), auto-applied at
> end-of-job and re-applied by an `agent-runner gc` command (`--force` to
> override, loud); and an `agent-runner status` command listing live/failed/
> retained jobs (distinct from `scan`, which stays the backlog queue). Refactor
> `run-once` to use this substrate.
>
> TDD with vitest: encoding (pure, exhaustive), and the worktree/mirror/deletion
> behaviour against throwaway git repos + a local `--bare` arbiter (mirror
> `claim.sh`'s verification). Match house style (NodeNext, tabs + single quotes,
> `type: module`); `commander` for new commands. "Done" = acceptance criteria met
> and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
