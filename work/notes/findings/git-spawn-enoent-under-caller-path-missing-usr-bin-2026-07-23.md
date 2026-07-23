---
kind: finding
slug: git-spawn-enoent-under-caller-path-missing-usr-bin
date: '2026-07-23'
status: fixed-in-tree
---

# `spawn git ENOENT` when the launching PATH omits `/usr/bin`, and the orphan-claim residue it leaves

## Symptom

Running `dorfl do task:<slug> --isolated --merge --review` (dorfl 0.10.0) from an MCP/agent Bash tool whose process `PATH` is a curated list (volta / pixi / brew / bun / cargo / `~/.local/bin`, etc.) that does NOT contain `/usr/bin` dies mid-run with:

```
failed to spawn 'git': spawnSync git ENOENT
```

(or the async twin `spawn git ENOENT`), right after the `CLAIMED` + `Start work: git fetch … && git switch …` lines. Intermittent across consecutive `do` runs with the same `PATH`, and NOT cured by `export PATH="/usr/bin:$PATH"` in the parent shell (the export never reached the git-spawning grandchild). A prior crash on the same slug also left a dangling `~/.dorfl/work/<repokey>__` entry that `dorfl gc --force` did NOT reap and `git worktree remove` rejected ("not a working tree"), needing a manual `rm`.

## Root cause (confirmed, exact sites)

`dorfl` spawns bare `git` and lets Node resolve it via the spawn env's `PATH`. It NEVER narrows `PATH` itself; it faithfully propagates whatever `PATH` launched it.

- `packages/dorfl/src/git.ts` `run()` / `runAsync()` spawn `git` with `env: options.env ?? process.env`. When `options.env` is supplied it REPLACES the environment, so `git` is resolved against `options.env.PATH`. If that `PATH` lacks the dir holding git (`/usr/bin`), the spawn throws `ENOENT` (git.ts `run()` throw at the `result.error` check; `runAsync()` `child.on('error')`).
- `packages/dorfl/src/identity.ts` `identityEnv(identity, base = process.env)` builds the git env as `{...base}`, so it PRESERVES `base.PATH` (it only ADDS `GIT_*` / `GH_TOKEN`). It does not strip `/usr/bin`; it faithfully carries an already-broken `PATH`.
- Every git-env origin is `identityEnv(identity, options.env ?? process.env)` (do.ts:870/2220, run.ts:564, cli.ts:280/350/2512/3062, intake.ts:597). `options.env` is itself `process.env` of the dorfl CLI, inherited from the MCP launch. So the git `PATH` is exactly the launcher's `PATH`.

Net: dorfl's git resolution was only as good as the `PATH` of whatever launched dorfl. On the reporting machine git is `/usr/bin/git` (and `/bin/git`); the curated launcher `PATH` omitted both, so `ENOENT`.

Reproduced deterministically (patched-vs-unpatched, same machine):

```
env={...process.env, PATH:'/home/.../.volta/bin:/home/.../.cargo/bin'}   # no /usr/bin
# OLD 0.10.0 git():   THREW: failed to spawn 'git': spawnSync git ENOENT
# PATCHED git():      OK (resolved /usr/bin/git, ran clean)
```

### Why INTERMITTENT

Not a dorfl code-path difference. Every dorfl git spawn uses the SAME inherited `PATH` (via `identityEnv` copy or bare `process.env`); there is no branch that constructs a narrower or wider env. The variance is OUTSIDE dorfl: the MCP/agent Bash tool hands `dorfl` a different `process.env` snapshot per invocation (and `dorfl` resolution / whether a git-bearing dir happens to be on `PATH`). One task's snapshot had a git dir; the next did not. A parent-shell `export` does not retro-fit the already-captured grandchild env, which is why it did not help.

## The orphan-claim residue (`~/.dorfl/work/<id>` blocking re-create)

`~/.dorfl/work/<work-id>/` is the job worktree (created by `git worktree add`), with a sibling `<work-id>.json` record. When a run crashes AFTER the `work/<id>` path appears but BEFORE `git worktree add` registers it (exactly the early `spawn git ENOENT` above), it leaves a record-less dir or a dangling symlink that:

- `workspace.ts` `clearStale` / `clearStaleWorktreeOnly` could not remove: `git worktree remove --force` fails "is not a working tree" and `git worktree prune` does not touch a non-registered path, so the next `git worktree add` fails "already exists".
- `gc.ts` `discoverJobs` never sees: it requires a sibling `.json` record (a dangling symlink also throws in `statSync().isDirectory()` and is skipped), so `gc` (even `--force`) never reaps it.

Hence the manual `rm`.

## Fix (in tree)

1. Robust git resolution + PATH hardening, all inside `git.ts` (one choke-point, every call site benefits):
   - `resolveGitBinary(env)` resolves `git` to an ABSOLUTE path per effective `PATH`: honour `DORFL_GIT` / `GIT` (absolute) override, else probe the env's own `PATH` FIRST (so a project-pinned / test-shim git still wins) then the standard system dirs APPENDED (`/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`), so `/usr/bin/git` is found even when the caller dropped `/usr/bin`. Cached PER effective PATH (NOT a global memo) so a shimmed env resolves independently. Falls back to bare `git` if genuinely absent.
   - `run()` / `runAsync()` funnel through `resolveSpawn`, which also UNIONS the system dirs into the spawn env's `PATH` so git's OWN children (hooks, `ssh`, `sh`) resolve too. Env is COPIED, never mutated; merge semantics unchanged for callers (they already pass a superset of `process.env`).
   - Fail-fast diagnostic: an `ENOENT` now reports `not found (tried '<abs>'). … Effective PATH=<path>` instead of the opaque `spawn git ENOENT`.

2. Orphan-claim self-heal:
   - `workspace.ts` `forceClearWorktreePath` (used by `clearStale` + `clearStaleWorktreeOnly`): after the git removal + prune, if the path SURVIVES (git refused it) it is an orphan git will not manage, so a bounded `rmSync` of that one path clears it. `lstatSync`-based presence so a DANGLING symlink is seen (not `existsSync`, which follows the link). ADR §4-safe: only ever removes a path git itself refused AND that carries no registered worktree.
   - `gc.ts` `sweepOrphans`: a `gc` sweep now removes record-less `work/*` orphans (dangling symlinks / crashed-before-register dirs), reported as `sweptOrphans` in `GcResult` and surfaced by the CLI. A record-bearing real job is untouched (goes through the reap predicate as before).

Tests: `test/git.test.ts` (new: resolution under a curated PATH, `DORFL_GIT` override, actionable ENOENT, shim-still-wins) and `test/gc.test.ts` (new: dangling-symlink sweep, orphan-dir sweep, real-job untouched, `createJob` recreates over an orphan dir). Full gate green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Operator note

The manual workaround `~/.local/bin/git -> /usr/bin/git` created during the incident is no longer needed once this ships; it is harmless to keep or remove. `DORFL_GIT=/usr/bin/git` is now a supported explicit override for locked-down environments.
