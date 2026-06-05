---
title: do-remote — `do --remote <r>` worker against a registered repo (mirror + job worktree)
slug: do-remote
prd: command-surface-phase-2
blockedBy: [registry-remote, do-in-place]
covers: [9]
---

## What to build

The `do --remote <r>` form: the per-repo worker run against a registered repo with
NO checkout (ADR §3). It materialises a **hub mirror + job worktree in the agents'
area** — the SAME isolation `run` uses — never the human area.

- **`do --remote <r> <arg>`** — resolve the registered remote (a hub mirror from
  `registry-remote`), materialise a mirror + job worktree in `workspacesDir` (the
  **job-worktree isolation strategy** from `isolation-strategy-seam`), then run the
  SAME `do` pipeline as the in-place form (`do-in-place`): claim + build + gate +
  integrate + exit, `--propose`/`--merge`.
- **Auto-register an unregistered `--remote`** — if `<r>` is not yet registered,
  create its hub mirror first (i.e. the `remote add` effect: `ensureMirror`), then
  proceed. This mirrors `work-on`'s existing remote form, which already
  `ensureMirror`s a missing mirror on the fly (creating if absent) — same
  primitive, now also the `remote add` path from `registry-remote`.
- **Agents' area, never the human area** — this is agent execution, so it uses
  `workspacesDir` (hub mirrors + job worktrees), honouring the storage-area/doer-
  axis invariant (ADR §2). `do --remote` reuses `run`'s isolation exactly; the only
  difference from `do <slug>` (in-place) is the isolation strategy selected.

This slice is the `--remote` selection + auto-registration on top of the existing
`do` pipeline; the pipeline itself is `do-in-place`'s.

## Acceptance criteria

- [ ] `do --remote <r> <arg>` materialises a hub mirror + job worktree in the
      agents' area (the job-worktree isolation strategy) and runs the same `do`
      pipeline (claim/build/gate/integrate/exit) as the in-place form.
- [ ] An unregistered `--remote` is auto-`remote add`ed (mirrored) before use.
- [ ] It uses `workspacesDir` (agents' area), never `humanWorktreesDir`; teardown
      re-applies the §4 deletion predicate (as `run` does).
- [ ] `--propose`/`--merge` and slug resolution behave identically to `do-in-place`.
- [ ] Tests (local `--bare` arbiter as the registered remote, temp agents' area,
      stubbed harness): `do --remote` against a registered remote runs end-to-end in
      a job worktree; an unregistered remote is auto-registered; the human area is
      never written.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `registry-remote` — resolves/auto-creates the hub mirror for `<r>` (the registry).
- `do-in-place` — reuses the `do` pipeline + selects the job-worktree isolation
  strategy instead of in-place; the pipeline must exist first.

## Prompt

> Build `do --remote <r>` per `docs/adr/command-surface-and-journeys.md` §3: the
> `do` worker run against a REGISTERED repo with no checkout — materialise a hub
> mirror + job worktree in the AGENTS' area (the job-worktree isolation strategy,
> the SAME isolation `run` uses), then run the same `do` pipeline as the in-place
> form. The ONLY difference from `do <slug>` is the isolation strategy. Reuse, do
> not reimplement, the `do-in-place` pipeline.
>
> FIRST run the drift check: confirm `do-in-place` (in `done/`) exposes a reusable
> pipeline that can take a job-worktree strategy; confirm `registry-remote` (in
> `done/`) exposes mirror resolution/auto-add; confirm `isolation-strategy-seam`'s
> job-worktree strategy. Route to needs-attention on any discrepancy.
>
> READ FIRST: ADR `command-surface-and-journeys` §2 (storage areas map onto the
> doer axis — agent execution → agents' area, never the human area) + §3, the done
> files/modules for `registry-remote` (mirror resolution + auto-add), `do-in-place`
> (the pipeline to reuse), and `isolation-strategy-seam` (the job-worktree
> strategy), plus `src/run.ts`'s `createJob`/`reapJob` (the agents'-area isolation +
> §4 teardown) and `src/work-on.ts` (the `--remote` auto-`remote add` precedent).
>
> Implement `--remote` selection: resolve the hub mirror (auto-create it via the
> `registry-remote` add path / `ensureMirror` if absent — the same on-the-fly
> mirroring `work-on`'s remote form already does), select the job-worktree
> isolation strategy, run the `do` pipeline, tear down per §4. Use `workspacesDir`,
> never `humanWorktreesDir`.
>
> TDD with vitest, house style (local `--bare` arbiter as the remote, temp agents'
> area, stubbed harness): end-to-end in a job worktree; auto-register an unknown
> remote; assert the human area is never touched. "Done" = acceptance criteria met
> and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim do-remote --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/do-remote <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/do-remote.md work/done/do-remote.md
```
