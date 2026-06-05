---
title: registry-remote — the registry IS the hub-mirror set (remote add/rm/ls/find; fold arbiter; kill roots)
slug: registry-remote
prd: command-surface-phase-2
blockedBy: []
covers: [1, 2, 3, 4, 5]
---

## What to build

The **registry** command group, establishing the ADR §1 model: *the registered
set of targets IS the set of hub mirrors on disk under `<workspacesDir>/repos/`* —
there is **no `roots` config field and no `remotes` field**.

- **`remote add <url> [--local]`** — register a target by creating its hub mirror
  (the existing `repo-mirror` / `ensureMirror` primitive). `--local` registers a
  local `--bare` arbiter (offline) — this **absorbs `arbiter init`** (derive/locate
  a bare arbiter under `arbitersDir`, then create its mirror). The mirror's
  `origin` URL is its self-description (scheme ⇒ transport: `git@`/`https`/`ssh` ⇒
  remote host; `file://`/path ⇒ local-bare) — no separate stamp.
- **`remote rm <key|url>`** — delete the mirror. The ONLY mirror deleter (`gc`
  never reaps mirrors). Plumbing tier.
- **`remote ls`** — enumerate the hub mirrors + each origin URL/transport. NOTE:
  the key encoding is LOSSY (it drops scheme/transport), so the origin URL is NOT
  reconstructible from the key — read it from each mirror with `git -C <mirror>
  remote get-url origin` (a hub mirror is a `--bare` clone whose `origin` is the
  arbiter). Derive the transport from that URL's scheme.
- **`remote find <folder>`** — discover `work/`-participating repos in a folder
  (reuse `isParticipatingRepo` from `detect.ts`; only repos with a populated
  `work/backlog/`), find-skills-style multi-select toggle, `remote add` each chosen.
- **Transport guard:** `remote add` guards on the full `host/org/name` identity
  (today's `encodeRepoKey`). Adding the same project under a DIFFERENT transport
  (e.g. a `--local` arbiter for a repo already registered remotely) → **error
  naming the existing transport** (read from the existing mirror's origin URL),
  unless `--force`. This implements the anti-stranding guard from
  `work/observations/hub-mirror-key-ignores-transport.md` (guard on project
  identity = the `org/name` tail, NOT the URL).
- **Fold `arbiter status` into `status`** — the `status` dashboard reports the
  current repo's arbiter (remote, URL/path, exists/bare, main reachable, the unsafe
  non-bare-with-main flag); the standalone `arbiter` command group is removed.
- **Remove the config `roots` field and rewire discovery to the hub-mirror set.**
  This is the load-bearing part of this slice, not a one-line field deletion. TODAY
  `roots` is woven through `config.ts`, `detect.ts` (`detectRepos`), `cli.ts`
  (`--root`/`--include`/`--exclude` flags + `flagOverrides`), `scan.ts` (`scan` calls
  `detectRepos({roots, include, exclude})` to find repos), `status.ts` (its
  `repoRoots` come from `detectRepos`), `env-config.ts`, and `repo-config.ts`.
  Removing `roots` means **discovery becomes "enumerate the registered hub mirrors"**
  — so `scan`/`status` (and `run`, reframed in a later slice) must resolve their repo
  set from the hub-mirror set under `<workspacesDir>/repos/`, NOT from a roots walk.
  Provide a single "list registered mirrors" primitive (the registry enumeration
  `remote ls` also uses) and point `scan`/`status` at it.
  - `detectRepos`/`isParticipatingRepo` are NOT deleted — `isParticipatingRepo` is
    reused by `remote find`, and the walk logic moves to serving `remote find
    <folder>`. What goes away is config-`roots`-driven *implicit* discovery.
  - `--root`/`--include`/`--exclude` flags: drop `--root` (the roots model is gone).
    `--include`/`--exclude` are out of scope to redesign here — if they have no
    meaning without `roots`, remove them; if they map onto "add/skip specific
    mirrors", that is a later concern. Decide minimally and note it; do NOT invent a
    new include/exclude-over-mirrors model in this slice.
  - Never add a `remotes` config field.
- **CRITICAL — mirrors are BARE; `scan`/`status` must read `work/` from a REF, not a
  working tree. This is a NEW read-seam capability and the deepest part of the
  slice.** Today `scan`/`status` read `work/` from a LOCAL CHECKOUT: `scan` calls
  `ledgerRead.resolveLocalState({repoPath})`, which `readdirSync`/`readFileSync`s
  `<repoPath>/work/backlog|done|needs-attention` — a real working tree. A hub mirror
  is a **`--bare` repo with NO working tree**, so `resolveLocalState` **cannot read
  it**. The read seam's ARBITER method (`resolveArbiterState`, `git show`/`ls-tree`
  against `<arbiter>/main`) reads only `work/done/` + a SINGLE named slice — NOT the
  full backlog, NOT needs-attention. So ADD a read-seam capability: **resolve the
  full live `work/` lifecycle (backlog + done + needs-attention) of a repo from its
  hub mirror's `main` ref** (`git ls-tree`/`git show`, extending the arbiter
  method's existing `done/` read to the full set). Route `scan`/`status` through
  THAT for their per-repo `work/` read instead of `resolveLocalState`. Keep it
  behind the read seam (its whole purpose is that readers don't learn a new
  mechanism) — do NOT scatter raw `git ls-tree` across `scan`/`status`.
  - **This is PROVEN sound** (verified against a real bare mirror): `git -C
    <mirror> ls-tree --name-only <ref>:work/backlog` enumerates the files and `git
    -C <mirror> show <ref>:work/backlog/<x>.md` returns the full content (frontmatter
    included) that `parseFrontmatter` needs — the same mechanism
    `readDoneSlugsOnArbiter`/`readSliceOnArbiter` already use, just widened to
    backlog + needs-attention.
  - **REF SPELLING nuance:** the existing arbiter read targets `<arbiter>/main:...`
    (a remote-tracking ref in a working CLONE). A hub mirror is bare, where `main`
    is a LOCAL branch — read `main:work/...` (or `HEAD:work/...`), NOT
    `origin/main:work/...`. Use the mirror-local ref, run with `git -C <mirrorPath>`.
  - (FETCHING each mirror before this read is the `scan-status-fetch-first` slice;
    THIS slice provides the mirror-ref READ that fetch-first keeps fresh.)

Key = `host/org/name` (today's `encodeRepoKey`, unchanged) — collapses
ssh/https/scp for one repo onto one mirror, keeps different hosts/projects distinct.
NOTE on module homes (so you don't chase ghosts): `encodeRepoKey` + `ensureMirror`
+ `createJob` live in `src/workspace.ts` / `src/repo-mirror.ts` (not a single
`repo-mirror.ts`); `arbiterInit`/`arbiterStatus`/`assertBare` are in `src/arbiter.ts`;
`isParticipatingRepo`/`detectRepos` are in `src/detect.ts`; the read seam is
`src/ledger-read.ts`. Tests live in `packages/agent-runner/test/`, not co-located.

## Acceptance criteria

- [ ] `remote add <url>` creates the hub mirror; `remote add --local` provisions a
      bare arbiter (the old `arbiter init` behaviour) AND its mirror; both are
      idempotent (an existing mirror/arbiter is detected, not clobbered).
- [ ] `remote add` of the same project under a different transport errors, naming
      the existing transport (read from the existing mirror's origin), unless
      `--force`.
- [ ] `remote ls` lists every mirror with its origin URL + transport; `remote rm`
      deletes a mirror by key or URL and is the only command that does so.
- [ ] `remote find <folder>` discovers `work/`-participating repos (via
      `isParticipatingRepo`) and toggle-adds the chosen ones.
- [ ] The config `roots` field is gone; no `remotes` field exists; **`scan` and
      `status` discover their repo set by enumerating the registered hub mirrors**
      (not `detectRepos(roots)`), via a shared "list mirrors" primitive. The
      standalone `arbiter` command group is removed (`arbiter init` → `remote add
      --local`; `arbiter status` → `status`). `isParticipatingRepo` is retained
      (reused by `remote find`).
- [ ] A read-seam capability resolves the full `work/` lifecycle (backlog + done +
      needs-attention) from a hub mirror's `main` REF (mirrors are bare —
      `resolveLocalState`'s working-tree read cannot be used); `scan`/`status`
      consume it through the seam (no raw `git ls-tree` scattered in scan/status).
- [ ] Tests (throwaway repos + a local `--bare` arbiter): add/ls/rm round-trip, the
      transport guard error + `--force` override, `remote find` discovery, `status`
      reporting arbiter state, AND reading backlog/done/needs-attention from a bare
      mirror's `main` ref.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — the registry foundation; other slices build on it.

## Prompt

> Build the **registry** command group per `docs/adr/command-surface-and-journeys.md`
> §1: the registered set of targets IS the hub mirrors on disk — no `roots`/`remotes`
> config field. Add `remote add/rm/ls/find`, fold `arbiter init` into
> `remote add --local` and `arbiter status` into `status`, and remove the config
> `roots` field.
>
> FIRST run the drift check (this slice is a launch snapshot): confirm `config.ts`
> still has `roots`, `arbiter.ts` still has `arbiterInit`/`arbiterStatus` as their
> own `arbiter` subcommands in `cli.ts`, `repo-mirror.ts`'s `ensureMirror`/
> `encodeRepoKey`, and `detect.ts`'s `isParticipatingRepo`. If a dependency landed
> differently, route to needs-attention with the discrepancy (WORK-CONTRACT.md
> "Drift is a needs-attention signal"), do not build on a stale premise.
>
> READ FIRST: ADR `command-surface-and-journeys` §1, `docs/adr/execution-substrate-
> decisions.md` §7 (arbiters are precious DATA under `arbitersDir`, never
> `~/.agent-runner`), `work/observations/hub-mirror-key-ignores-transport.md` (the
> transport guard — guard on the `org/name` project-identity tail, NOT the URL;
> precedent: `assertBare` in `arbiter.ts`), `src/repo-mirror.ts` (`ensureMirror`,
> `encodeRepoKey`), `src/arbiter.ts` (`arbiterInit`/`arbiterStatus` to fold),
> `src/detect.ts` (`isParticipatingRepo` to reuse for `remote find`), `src/config.ts`
> (the `roots` field to remove), `src/scan.ts` (it calls `detectRepos({roots,...})`
> — rewire to enumerate mirrors), `src/status.ts` (its `repoRoots` come from
> `detectRepos` — rewire; also where arbiter state now folds in), and `src/cli.ts`
> (the `arbiter` group + the `--root`/`--include`/`--exclude` flags + `flagOverrides`,
> and where `remote` lands).
>
> CRITICAL #1: removing `roots` is NOT a field deletion — it is rewiring
> `scan`/`status` discovery from a roots walk to enumerating the registered
> hub-mirror set. Provide one "list registered mirrors" primitive (shared with
> `remote ls`) and point `scan`/`status` at it. Keep `isParticipatingRepo` (it
> serves `remote find`). Do NOT invent a new include/exclude-over-mirrors model —
> drop `--root`; if `--include`/`--exclude` are meaningless without `roots`, remove
> them and note it.
>
> CRITICAL #2 (deepest): hub mirrors are BARE — no working tree. `scan`/`status`
> today read `work/` via `ledgerRead.resolveLocalState({repoPath})`, which
> `readdirSync`/`readFileSync`s a LOCAL CHECKOUT — that CANNOT read a bare mirror.
> The read seam's arbiter method reads only `done/` + one slice. So ADD a read-seam
> capability "resolve full `work/` (backlog + done + needs-attention) from a
> mirror's `main` ref" (git ls-tree/show against `<mirror>/main:work/...`, extending
> the arbiter method's existing `done/` read) and route `scan`/`status` through it.
> Keep it behind the read seam — do not scatter raw git calls. (Fetching the mirror
> before the read is the `scan-status-fetch-first` slice; here you build the
> mirror-ref READ.)
>
> Implement `remote add <url> [--local]` (create mirror; `--local` provisions a
> bare arbiter + mirror, absorbing `arbiter init`; transport guard), `remote rm`
> (only mirror deleter), `remote ls` (mirrors + origin URL/transport), `remote find
> <folder>` (toggle-add discovered participating repos). Fold `arbiter status` into
> `status`. Remove `roots` (never add `remotes`); discovery = the registered
> hub-mirror set.
>
> TDD with vitest, house style (throwaway repos + local `--bare` arbiter): add/ls/rm
> round-trip, transport-guard error + `--force`, `remote find` discovery, `status`
> reporting arbiter state. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim registry-remote --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/registry-remote <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/registry-remote.md work/done/registry-remote.md
```
