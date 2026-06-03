---
title: integration provider — GitHub (gh) propose/PR adapter
slug: integration-github
prd: agent-runner
afk: false
blocked_by: [agent-workspaces]
covers: [7, 8]
created: 2026-06-03
claimed_by:
claimed_at:
---

## What to build

The concrete **GitHub** provider for the integration seam introduced by
`agent-workspaces` (ADR §6, `work/findings/execution-substrate-decisions.md`):
the `propose` mode's review-request step, implemented via `gh`.

End-to-end:

- A `github` provider adapter that, in `propose` mode, opens a pull request for
  an already-pushed `work/<slug>` branch via `gh pr create` (the push itself is
  the provider-agnostic, safety-bearing step done by the seam — this adapter only
  adds the review request on top).
- **Provider auto-detection**: recognise a GitHub arbiter from its remote URL and
  select this adapter by default; allow explicit `provider` config override.
- Graceful behaviour when `gh` is absent/unauthenticated: fall back to the `none`
  behaviour (branch is pushed; print the URL / instructions to open a PR
  manually) rather than failing the job — the work is already safe.
- Surface the created PR URL in the job record / `status`.

The core never imports `gh`; only this adapter shells out to it.

## Acceptance criteria

- [ ] In `propose` mode with a GitHub arbiter, a green job results in a pushed
      branch AND a PR opened via `gh pr create`; the PR URL is recorded.
- [ ] GitHub arbiter is auto-detected from the remote URL; `provider` config
      overrides detection.
- [ ] When `gh` is missing/unauthenticated, it degrades to `none` (push + manual
      instructions), not a hard failure; deletion-safety is unaffected (the branch
      is pushed).
- [ ] `merge` mode is unaffected (provider-agnostic git path).
- [ ] Never `--force` to main.
- [ ] Tests stub `gh` (don't hit the network/real GitHub); verify the adapter is
      selected by URL detection, calls the expected `gh` command, and degrades
      gracefully when `gh` is unavailable.

## Blocked by

- `agent-workspaces` — provides the integration seam (mode + provider) and the
  `none` provider this builds on.

## Prompt

> Implement the **GitHub** integration provider for `agent-runner`, fulfilling the
> provider seam created by `agent-workspaces`. READ FIRST: ADR §6 in
> `work/findings/execution-substrate-decisions.md` (mode × provider; push is the
> guarantee; `propose` not `pr`), and the integration-seam code from
> `agent-workspaces` (with its `none` provider).
>
> Build a `github` provider that, in `propose` mode, opens a PR via `gh pr create`
> for an already-pushed `work/<slug>` branch (the seam does the push; you add the
> review request). Auto-detect a GitHub arbiter from its remote URL and select
> this provider by default, with an explicit `provider` config override. If `gh`
> is missing/unauthenticated, degrade to the `none` behaviour (branch pushed +
> print manual-PR instructions) — never hard-fail, since the work is already safe.
> Record the PR URL in the job record / `status`. The core must NOT import `gh`;
> only this adapter shells out to it. Never `--force` to main.
>
> TDD with vitest; STUB `gh` (no network / real GitHub): verify URL-based
> selection, the expected `gh` invocation, and graceful degradation when `gh` is
> absent. Match house style. "Done" = acceptance criteria met and `pnpm -r build
> && pnpm -r test && pnpm -r format:check` green.
