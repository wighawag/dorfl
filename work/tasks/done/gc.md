---
title: gc — provably-safe deletion of job worktrees
slug: gc
prd: agent-runner
humanOnly: true
blockedBy: [agent-workspaces]
covers: [12]
---

## What to build

The reaper for job worktrees, governed by the **provably-safe deletion predicate** (ADR §4 in `docs/adr/execution-substrate-decisions.md`). Split out of `agent-workspaces` so the substrate stays thin; this slice owns deletion.

End-to-end:

- **Deletion predicate:** a job's worktree may be removed iff (a) its working tree is **clean** AND (b) its branch tip is **reachable on the arbiter** — either merged (`git merge-base --is-ancestor <tip> <arbiter>/main`) OR pushed (`<arbiter>/<branch>` tip == local tip). Both true ⇒ the work is provably on the arbiter ⇒ safe to remove. Otherwise ⇒ **retain** (the retained worktree is a needs-attention signal).
- **Auto-reap at end-of-job:** when a job finishes and the predicate holds, remove its worktree (via `git worktree remove` + prune — never bare `rm -rf`).
- **`agent-runner gc`:** re-apply the predicate to every `work/*/` job, reaping the provably-safe ones and **reporting each retained one with a reason** ("unmerged commits" / "dirty tree" / "branch not pushed"). The catch-up for when auto-reap didn't run (runner crash/kill).
- **`--force`:** override the predicate (discard un-saved work) — loud, explicit confirmation, NEVER the default.

Reads the per-job record + worktree state produced by `agent-workspaces`.

## Acceptance criteria

- [ ] Predicate enforced: removed only when clean AND tip reachable on the arbiter (merged-ancestor OR pushed-tip-equal); otherwise retained. Both branches unit/integration-tested against a local `--bare` arbiter.
- [ ] Auto-reap removes a provably-safe finished job's worktree via `git worktree     remove` (+ prune), never `rm -rf`.
- [ ] `agent-runner gc` reaps all provably-safe jobs and reports each retained one with a clear reason.
- [ ] `--force` overrides (loud/confirmed); never default.
- [ ] A job whose work is NOT on the arbiter is never auto-removed.
- [ ] Tests use throwaway repos + a local `--bare` arbiter, covering both predicate branches + the retain-and-report path.

## Blocked by

- `agent-workspaces` — provides the worktrees + per-job records this reaps.

## Prompt

> Implement provably-safe deletion + `agent-runner gc` in `packages/agent-runner/`. READ FIRST: ADR §4 in `docs/adr/execution-substrate-decisions.md` (authoritative), and the `agent-workspaces` workspace/job-record code. Follow `AGENTS.md`.
>
> Deletion predicate: remove a job worktree iff clean tree AND branch tip reachable on the arbiter (`git merge-base --is-ancestor` for merged, OR remote branch tip == local tip for pushed); otherwise retain. Auto-reap finished jobs that satisfy it (via `git worktree remove` + prune — never `rm -rf`). `agent-runner gc` re-applies the predicate across `work/*/`, reaps safe ones, reports retained ones with reasons; `--force` overrides loudly (never default). A job whose work isn't on the arbiter must never be auto-removed (retained worktree = needs-attention signal).
>
> TDD with vitest against throwaway repos + a local `--bare` arbiter: both predicate branches, retain-and-report, and `gc`. "Done" = acceptance criteria met and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
