---
title: repo-mirror — the shared bare hub mirror primitive (ensure/locate/fetch)
slug: repo-mirror
prd: agent-runner
humanOnly: true
blocked_by: [scan]
covers: [6]
created: 2026-06-03
claimed_by:
claimed_at:
---

## What to build

The **shared hub-mirror primitive** that both the autonomous job runner
(`agent-workspaces`) and the human `work-on` command build on. Extracted as its
own slice because it is used by two different consumers (ADR §2 +
`docs/adr/execution-substrate-decisions.md` — the mirror is the foundation
the job/worktree layer sits on).

End-to-end:

- **Repo→key encoding** (ADR §2): deterministic function from an arbiter remote
  URL to a hierarchical hub key — drop scheme/user/`.git`, replace `.`→`-` per
  segment (lossless), e.g. `git@github.com:wighawag/agent-runner.git` →
  `github-com/wighawag/agent-runner`.
- **Ensure-mirror**: given a remote URL (or name resolved from a repo), locate the
  bare hub mirror at `~/.agent-runner/repos/<key>.git` (config `workspacesDir`);
  if absent, create it (`git clone --bare` / mirror); if present, `git fetch` it.
  Idempotent.
- **Fresh `<arbiter>/main`**: callers can ask for the mirror's `main` after a
  fetch, so worktrees always branch off the latest arbiter main (the guarantee
  `work-on` and the job runner both rely on).
- Treated as STATE not cache (ADR §3): lives under `~/.agent-runner/`, never
  `~/.cache`; regenerable but not housed where cleaners would purge it.

This slice does NOT create worktrees, claim, or run anything — it only manages
the mirror. Worktree/job logic (agent-workspaces) and human worktrees (work-on)
consume it.

## Acceptance criteria

- [ ] Encoding is deterministic, `.`→`-` per segment, hierarchical; unit-tested
      over several URL shapes (ssh, https, with/without `.git`).
- [ ] Ensure-mirror creates a bare mirror under
      `~/.agent-runner/repos/<key>.git` when absent, and fetches when present;
      idempotent.
- [ ] Callers can obtain the freshly-fetched `main` of the mirror.
- [ ] Lives under `~/.agent-runner/` (config `workspacesDir`), never `~/.cache`.
- [ ] Tests use throwaway repos + a local `--bare` arbiter; verify create-once-
      then-fetch reuse (no re-clone on second call).

## Blocked by

- `scan` — needs the package/core + config; independent of the job/worktree layer.

## Prompt

> Implement the shared hub-mirror primitive for `agent-runner` in
> `packages/agent-runner/`. READ FIRST: ADR §2 and §3 in
> `docs/adr/execution-substrate-decisions.md` (isolation foundation;
> state-not-cache).
>
> Build: the deterministic repo→key encoding (arbiter URL → hierarchical key,
> `.`→`-` per segment, lossless); and an ensure-mirror operation that, given a
> remote URL (or a remote resolved from a repo), locates `~/.agent-runner/repos/
> <key>.git` (config `workspacesDir`), creates it bare if absent, fetches if
> present (idempotent), and exposes the freshly-fetched `main`. It must NOT create
> worktrees, claim, or run anything — it is the mirror primitive that
> `agent-workspaces` (jobs) and `work-on` (human worktrees) both consume.
>
> TDD with vitest against throwaway repos + a local `--bare` arbiter: encoding
> over several URL shapes; create-once-then-fetch reuse (second call fetches, does
> not re-clone). Match house style; this may be a library module + minimal CLI
> surface as needed. "Done" = acceptance criteria met and `pnpm -r build && pnpm
> -r test && pnpm -r format:check` green.
