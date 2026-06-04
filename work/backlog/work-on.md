---
title: work-on — create a human worktree (parallel work) from current main
slug: work-on
prd: agent-runner
humanOnly: true
blocked_by: [repo-mirror, claim-command]
covers: [5, 6]
created: 2026-06-03
claimed_by:
claimed_at:
---

## What to build

`agent-runner work-on` — a **human** command to claim a slice and set up an
isolated **worktree in a human-friendly location**, so a person can open their
editor and work several slices in parallel without juggling branches in one
checkout. This is the human counterpart to the runner's job worktrees; it is NOT
used by agents (so it never carries secrets into agent contexts — see `--copy`).

Two invocation forms:

- `work-on <slug>` — run inside an existing clone; the arbiter remote is inferred
  from the current repo.
- `work-on <remote> <slug>` — run anywhere; ensures a hub mirror for `<remote>`
  exists (creating it via `repo-mirror` if absent, like agents do), then works
  from it.

End-to-end (BOTH forms):

- **Claim** the slug (via `claim-command`) against the resolved arbiter.
- **Always fetch + branch off the freshly-fetched `<arbiter>/main`** — never a
  possibly-stale local `origin/main`. THIS GUARANTEE is what makes the two forms
  equivalent: the *only* intended difference between in-repo and remote mode is
  **where the worktree's files live**, never the starting commit or the claim/
  integration semantics. The same slug yields equivalent work either way.
- **Create the worktree** at a human-friendly location (NOT `~/.agent-runner/` —
  that's the agents' area). On first use, **prompt the human for the worktree
  root and save it to config** (`humanWorktreesDir`); offer a sensible suggestion
  but no silent default, and avoid a root that shares a prefix with their code
  dirs (so shell tab-completion never collides). Worktree path is e.g.
  `<humanWorktreesDir>/<key>/<slug>/` on branch `work/<slug>`.
- **`--copy <patterns>`** (comma-separated): copy the named gitignored files
  (e.g. `.env.local,.env`) into the new worktree so the project is runnable
  (a fresh worktree has none of your untracked files). COPY, not symlink
  (tooling-safe). Source = the current repo when in-repo; in **remote mode** there
  is no implicit source, so `--copy` requires **`--copy-from <path>`**. Print a
  one-line **security notice** naming what was copied and that secrets now live in
  a second location. (Follow-up, not this slice: bare `--copy` with no args could
  present a togglable picker built from `.gitignore` — including nested
  `.gitignore` files that are themselves not gitignored, e.g. not under
  `node_modules`. Out of scope here.)
- **Land the human in the worktree**: a binary cannot `cd` its parent shell, so
  print the worktree path (and a `cd` hint), and support `--print-dir` (path-only
  to stdout) so users can install a shell function
  (`work-on(){ cd "$(agent-runner work-on "$@" --print-dir)"; }`) that actually
  cd's them. Document both.

The docs must make the in-repo-vs-remote distinction explicit: same remote, same
claim, same integration, same starting commit (latest arbiter main) — only the
worktree location differs.

## Acceptance criteria

- [ ] `work-on <slug>` (in a repo) and `work-on <remote> <slug>` (anywhere) both
      claim, then create a worktree on `work/<slug>` branched off the
      freshly-fetched `<arbiter>/main`.
- [ ] Remote mode ensures a hub mirror (via `repo-mirror`), creating it if absent.
- [ ] Both modes start from the SAME commit given the same arbiter state (the
      fetch guarantee); the only difference is worktree location — asserted by a
      test.
- [ ] Worktree lives under the configured `humanWorktreesDir` (prompted + saved on
      first use; never under `~/.agent-runner/`); never used by agents.
- [ ] `--copy <patterns>` copies the named gitignored files from the source
      (current repo in-repo; `--copy-from <path>` required in remote mode), copy
      not symlink, with a security notice. Absent `--copy`, no untracked files
      are carried over.
- [ ] On a lost/contended claim, no worktree is created (clean failure, like
      `claim`).
- [ ] `--print-dir` emits the worktree path only (stdout), for shell-function cd.
- [ ] Tests cover both forms, the same-starting-commit guarantee, `--copy`
      (+ remote-mode `--copy-from` requirement), and the clean-failure path,
      against throwaway repos + a local `--bare` arbiter.

## Blocked by

- `repo-mirror` — remote mode ensures/uses the hub mirror primitive.
- `claim-command` — `work-on` claims via the in-process claim.

## Prompt

> Implement `agent-runner work-on` in `packages/agent-runner/` — the HUMAN command
> to claim a slice and create an isolated worktree in a human-friendly location
> for parallel work. READ FIRST: ADR §2/§3/§7 in
> `docs/adr/execution-substrate-decisions.md`, and the `repo-mirror`,
> `claim-command`, and `start` slices.
>
> Two forms: `work-on <slug>` (infer arbiter from the current repo) and
> `work-on <remote> <slug>` (ensure a hub mirror via repo-mirror, creating if
> absent). BOTH: claim the slug, then ALWAYS `git fetch` and branch the worktree
> off the freshly-fetched `<arbiter>/main` — never a stale local ref. The ONLY
> intended difference between the two forms is the worktree's filesystem location;
> claim, integration, and starting commit are identical. Make the docs say this
> plainly.
>
> Create the worktree under a configured `humanWorktreesDir` (prompt + save on
> first use; sensible suggestion, no silent default; avoid a prefix that collides
> with the user's code dirs for tab-completion) — NEVER under `~/.agent-runner/`
> (that is the agents' area; work-on is human-only). `--copy <patterns>` copies
> named gitignored files (copy, not symlink) from the current repo (in-repo) or
> from `--copy-from <path>` (required in remote mode), printing a security notice.
> A binary can't cd the parent shell: print the path + a cd hint and support
> `--print-dir` for a shell-function wrapper; document both.
>
> TDD with vitest against throwaway repos + a local `--bare` arbiter: both forms;
> the same-starting-commit guarantee; `--copy`/`--copy-from`; clean failure on a
> lost claim (no worktree). Match house style; `commander`. "Done" = acceptance
> criteria met and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
