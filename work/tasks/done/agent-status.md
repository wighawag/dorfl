---
title: agent status — operational view of live / failed / retained jobs
slug: agent-status
prd: dorfl
humanOnly: true
blockedBy: [agent-workspaces]
covers: [11]
---

## What to build

`dorfl status` — the operational dashboard of **jobs** (distinct from `scan`, which is the backlog _queue_). Split out of `agent-workspaces` so the substrate stays thin; this slice owns the view. See ADR §4/§5/§12.

End-to-end:

- List the jobs under `~/.dorfl/work/*/` from their `.dorfl-job.json` records + worktree state, grouped by state: **active** (running), **failed / retained** (stuck or un-reaped), with per-job: slug, repo, branch, started-at, and — for stuck ones — the **reason** (from the `needs-attention` mechanism).
- **Liveness** comes from the harness seam (e.g. PID alive / session ref), NOT filesystem mtime (ADR §5).
- It is **read-only**: it inspects records/worktrees; it never claims, runs, moves, or deletes (deletion is `gc`).
- Distinct from `scan`: `scan` answers "what work is in the backlog and who can take it"; `status` answers "what is running / stuck / awaiting cleanup right now". The retained-worktree + `needs-attention/` items are the "look here" set.

## Acceptance criteria

- [ ] `dorfl status` lists jobs grouped active / failed-or-retained, each with slug, repo, branch, started-at, and (if stuck) the reason.
- [ ] Liveness is reported via the harness seam, not mtime.
- [ ] Read-only: no claim/run/move/delete side effects.
- [ ] Output is clearly distinct from `scan` (jobs, not the backlog queue).
- [ ] Tests cover rendering of active vs retained/failed jobs from fixture job records (+ a stub harness for liveness).

## Blocked by

- `agent-workspaces` — provides the per-job records + worktrees this reads.

## Prompt

> Implement `dorfl status` in `packages/dorfl/`. READ FIRST: ADR §4/§5/§12 in `docs/adr/execution-substrate-decisions.md`, and the `agent-workspaces` per-job-record/worktree code + the harness seam. Follow `AGENTS.md`.
>
> List jobs under `~/.dorfl/work/*/` from their `.dorfl-job.json` records + worktree state, grouped active / failed-or-retained, with slug, repo, branch, started-at, and (for stuck jobs) the reason recorded by the `needs-attention` mechanism. Liveness via the harness seam (PID/session), NOT mtime. READ-ONLY — no claim/run/move/delete. Keep it clearly distinct from `scan` (scan = backlog queue; status = running/stuck/awaiting-cleanup jobs).
>
> TDD with vitest: render active vs retained/failed from fixture job records, with a stub harness for liveness. "Done" = acceptance criteria met and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
