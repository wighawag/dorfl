---
title: agent workspaces — hub mirrors + isolated job worktrees + seams (core)
slug: agent-workspaces
prd: agent-runner
humanOnly: true
blockedBy: [run-once, repo-mirror]
covers: [5, 6, 10, 12]
---

> Scope note: this is the **core** substrate. Two lifecycle concerns were split out to keep this slice thin: provably-safe deletion + the `gc` command live in the `gc` slice; the operational `status` command lives in the `agent-status` slice. This slice provides the workspace + seams they build on. It also **supersedes `run-once`'s first-cut isolation** for stories 6/10/12 (run-once is refactored onto this substrate).

## What to build

The execution substrate that replaces `run-once`'s ad-hoc "worktree or clone" isolation with a real, reusable mechanism: per-repo hub mirrors + per-job isolated worktrees + the two seams (harness, integration) + safe rebase-before- integrate. See `docs/adr/execution-substrate-decisions.md` (§1–§6, §10) — the authoritative design.

End-to-end:

- **Workspace layout** under `~/.agent-runner/` (config `workspacesDir`; STATE, never a cache dir — ADR §3):
  - hub mirror via the **`repo-mirror`** primitive (this slice does NOT reimplement mirror management or the repo→key encoding — it consumes them).
  - `work/<work-id>/` — one worktree per job (flat work-id `<host-...>__<org>__<name>__<slug>`), checked out OUTSIDE the hub on branch `work/<slug>`, branched off the freshly-fetched `<hub>/main`.
  - `work/<work-id>/.agent-runner-job.json` — job record: slug, repoKey, branch, startedAt, state, harness block. (The record's `state` + the worktree's existence are what `gc` and `status` read.)
- **Create / run a job**: ensure the mirror (repo-mirror), `git worktree add`, run via the harness seam.
- **Harness seam** (ADR §5): interface for launching a job's command + reporting liveness. Ship a **null adapter** (records PID, runs a configured command; liveness from the harness, never mtime) so this is testable standalone. (pi adapter = its own slice.)
- **Integration seam** (ADR §6): an `Integrator` with `merge` (ff/rebase onto `<arbiter>/main`, push to main) and **`propose`** (push the branch + request review via a provider seam). Ship the provider-agnostic part + a **`none`** provider (push + "open a request manually"); `github`/`gh` = its own slice. The safety-bearing action is the `git push`.
- **Rebase-before-integrate** (ADR §10): `git fetch` + rebase `work/<slug>` onto the latest `<arbiter>/main`. Clean → proceed. Conflict → `git rebase --abort` + route to the `needs-attention` mechanism (never auto-resolve).
- **Refactor `run-once`** to create/claim/run/integrate via this substrate (one isolation path; ADR §1 jobs-not-agents).

Deletion of a finished job's worktree is governed by the predicate in ADR §4 but is OWNED by the `gc` slice — this slice just leaves the job record + worktree in a state `gc` can evaluate (it does not implement the reaper).

## Acceptance criteria

- [ ] Hub mirror obtained via `repo-mirror` (not reimplemented); reused across jobs (fetch, not re-clone).
- [ ] Each job runs in its own worktree at `~/.agent-runner/work/<work-id>/` on `work/<slug>`; two jobs never share a tree; distinct slugs ⇒ distinct branches (no same-branch worktree collision).
- [ ] A per-job record (`.agent-runner-job.json`) captures slug/repoKey/branch/ state/harness so `gc` and `status` can read it.
- [ ] Harness seam exists with a working null adapter; liveness from the harness, not mtime.
- [ ] Integration seam exists with `merge` + `propose` modes and a `none` provider; `propose` pushes the branch; never `--force` to main.
- [ ] Before integrating, the branch is rebased onto the latest `<arbiter>/main`; a conflicting rebase is aborted and routed to `needs-attention` (never auto-resolved).
- [ ] `run-once` is refactored to use this substrate (no second isolation path).
- [ ] Tests use throwaway git repos + a local `--bare` arbiter (mirror the `claim.sh` verification approach).

## Blocked by

- `run-once` — this refactors run-once's execution onto the new substrate.
- `repo-mirror` — provides the hub-mirror primitive + encoding this consumes.

## Prompt

> Build the CORE execution substrate for `agent-runner` (`packages/agent-runner/`). READ FIRST: `docs/adr/execution-substrate-decisions.md` (§1–§6, §10), the `repo-mirror` slice (the mirror+encoding primitive you consume), the existing `run-once` implementation/tests, and `AGENTS.md`. NOTE: the `gc` command (deletion) and the `status` command are SEPARATE slices — do NOT build them here; just leave the per-job record + worktree in a state they can read.
>
> Implement: a workspace manager that, via `repo-mirror`, maintains per-repo bare hub mirrors and creates per-job git worktrees (outside the hub) under `~/.agent-runner/` (config `workspacesDir`), on `work/<slug>` off the freshly-fetched mirror main, with a `.agent-runner-job.json` record; a **harness seam** + null adapter (PID + configured command; liveness from the harness, not mtime); an **integration seam** with `merge`/`propose` + a `none` provider (push-only; `gh` provider is a separate slice); rebase-before-integrate (ADR §10: clean → proceed, conflict → abort + route to `needs-attention`, never auto-resolve). Refactor `run-once` to use this substrate (one isolation path).
>
> TDD with vitest: encoding reuse, worktree creation/isolation, the seams (null harness, none-provider integration), and rebase-or-abort — against throwaway repos + a local `--bare` arbiter. "Done" = acceptance criteria met and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
