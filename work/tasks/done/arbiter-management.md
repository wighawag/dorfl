---
title: arbiter management — provision/locate a local bare arbiter from a repo
slug: arbiter-management
prd: dorfl
humanOnly: true
blockedBy: [scaffold]
covers: []
---

## What to build

Commands to provision and inspect a **local `--bare` arbiter** — the offline source of truth the claim/integration protocols serialize on. Per ADR §7 (`docs/adr/execution-substrate-decisions.md`), an arbiter is precious DATA: it must NOT live under `~/.dorfl/` and defaults under `~/git/`.

End-to-end:

- `dorfl arbiter init [<repo>] [--at <path>] [--remote <name>]` — derive a bare arbiter from an existing working repo: `git clone --bare <repo> <arbiter-path>`, then wire the repo's `<remote>` (default e.g. `arbiter` or `origin` per config/CLAIM-PROTOCOL) to point at it. Default arbiter path is **hierarchical** under `~/git/`: `~/git/<host>/<org>/<name>.git` (config `arbitersDir`; `.`→`-` per segment, reusing the workspace encoding). `<repo>` defaults to the current repo.
- `dorfl arbiter status` — report, for the current repo: which remote is the arbiter, its resolved path/URL, whether it exists and is bare, and whether `main` is reachable. Read-only.
- Refuse unsafe setups clearly (e.g. a non-bare arbiter with `main` checked out — CLAIM-PROTOCOL warns this rejects claim pushes). Idempotent init (don't clobber an existing arbiter; report and exit).

This is independent setup tooling; it provisions what `claim`/`run-once`/ `agent-workspaces` later consume. It does not itself claim or run anything.

## Acceptance criteria

- [ ] `arbiter init` creates a bare arbiter from an existing repo at the resolved `~/git/<host>/<org>/<name>.git` path (or `--at`), and wires the repo remote.
- [ ] The arbiter is created `--bare` (never a non-bare repo with main checked out); the command refuses/repairs the unsafe case with a clear message.
- [ ] `arbiter init` is idempotent: an existing arbiter is detected and not clobbered.
- [ ] Default location is under `~/git/` (config `arbitersDir`), hierarchical, `.`→`-` per segment — NEVER under `~/.dorfl/`.
- [ ] `arbiter status` reports remote name, path/URL, bare-ness, and main reachability; read-only.
- [ ] After `arbiter init`, a subsequent `claim` (via claim.sh or `dorfl claim`) against that arbiter succeeds end-to-end.
- [ ] Tests against throwaway repos verify init wiring, idempotency, and the unsafe-config refusal.

## Blocked by

- `scaffold` — only needs the package skeleton; independent of the rest.

## Prompt

> Implement `dorfl arbiter init` and `dorfl arbiter status` in `packages/dorfl/`. READ FIRST: ADR §7 in `docs/adr/execution-substrate-decisions.md` (arbiters are precious data, default under `~/git/<host>/<org>/<name>.git`, NEVER under `~/.dorfl/`), and `skills/to-slices/CLAIM-PROTOCOL.md` (the offline-arbiter setup it documents — bare by construction; a non-bare repo with main checked out rejects claim pushes).
>
> `arbiter init [<repo>] [--at <path>] [--remote <name>]`: `git clone --bare` an existing repo to the resolved hierarchical path under `~/git/` (config `arbitersDir`; reuse the workspace `.`→`-` per-segment encoding), then set the repo's arbiter remote to it. Idempotent (detect + don't clobber). Refuse the unsafe non-bare-with-main case clearly. `arbiter status`: read-only report of the current repo's arbiter remote, path/URL, bare-ness, and main reachability.
>
> TDD with vitest against throwaway repos: init wiring + idempotency + unsafe refusal, and a claim succeeding against the provisioned arbiter. Match house style; `commander` for the commands. "Done" = acceptance criteria met and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
