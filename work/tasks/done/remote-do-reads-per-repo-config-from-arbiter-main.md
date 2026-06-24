---
title: remote-do-reads-per-repo-config-from-arbiter-main — make `do --remote`/`--isolated` HONOUR the target repo's committed `.dorfl.json` (read it from the arbiter's main / job worktree and layer the whitelisted keys), restoring `flag > env > per-repo > global > default` parity so harness/verify/provider are not silently dropped
slug: remote-do-reads-per-repo-config-from-arbiter-main
covers: []
---

> Self-contained fix slice — derives from NO PRD (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Source signal: `work/observations/remote-do-ignores-per-repo-config.md` (delete it once this lands). Discovered live while driving the backlog with `do --remote` (the conductor hit BOTH symptoms: harness dropped → "no agentCmd"; verify dropped → false gate red). UNBLOCKS making `--remote`/`--isolated` the conductor's default isolation mode (`drive-backlog-skill-assumes-in-place-do-not-remote.md`).

## What to build

`do --remote <url> <slug>` (and the planned `do --isolated <slug>`, slice `do-isolated-in-place`) resolve config from **global + flags ONLY** — the target repo's committed `.dorfl.json` is NEVER read (see `src/cli.ts`, the `flags.remote !== undefined` branch: `resolveGlobalConfig(global, doFlagOverrides(...))`). The in-place `do` branch, by contrast, layers `resolveRepoConfig(cwd, …)`. So in `--remote` mode the repo's DECLARED, collaborator-agreed `harness` / `verify` / `provider` / `model` / `reviewModel` (all whitelisted per-repo keys in `src/repo-config.ts` `REPO_ALLOWED_KEYS`) are silently dropped to global+default.

Observed consequences (both real, both hit while driving this very repo):

- `harness: pi` dropped → resolved harness defaults to `null` → `error: no agentCmd configured`.
- `verify: "pnpm format:check && pnpm build && pnpm test"` dropped → default `pnpm -r build && pnpm -r test && pnpm -r format:check` used → `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` (this repo runs `format:check` at the ROOT, not per-package) → a FALSE gate red routing green work to needs-attention.

**Fix:** make the `--remote`/`--isolated` path READ the target repo's committed `.dorfl.json` from the ARBITER and layer ONLY its whitelisted (`REPO_ALLOWED_KEYS`) keys into the resolution, restoring the SAME chain in-place `do` uses: `flag > env > per-repo > global > default`. The committed file IS reachable — it is a tracked file on `<arbiter>/main`, and `--remote` already materialises a hub mirror + cuts a job worktree off that main. The host-only rejected keys (`agentCmd`, `piBin`, `sessionsDir`, `identity`, …) STAY global/flag/env-only exactly as `repo-config.ts` already enforces (a committed repo file must never carry host policy/secrets).

## Two viable read points (pick the cleaner; justify in a `## Decisions` block)

1. **Read from the mirror BEFORE materialising the worktree** — `git show <arbiter>/main:.dorfl.json` against the bare hub mirror (after `ensureMirror`), parse + filter via the EXISTING `loadRepoConfig`/`resolveRepoConfig` filtering (reuse `REPO_ALLOWED_KEYS`/`REPO_REJECTED_KEYS` — do NOT reimplement the allow/reject split), and feed the result into the config resolution that wires harness/verify/gate. Cleanest: config is known up front, same as today's flow, just with the per-repo layer restored.
2. **Read from the job worktree AFTER it is cut** — the worktree is a real checkout of arbiter main with `.dorfl.json` on disk; resolve config there. Faithful but later in the flow (harness/gate are wired up front in the CLI today, so this needs the wiring moved/deferred).

Prefer (1) if it keeps the CLI's up-front harness/gate wiring intact. EITHER way, REUSE the existing per-repo read+filter machinery (`src/repo-config.ts`) — the ONLY new logic is sourcing the file bytes from the arbiter instead of `cwd`.

## Scope

- IN: source the committed `.dorfl.json` from `<arbiter>/main` (mirror or job worktree) on the `--remote` (and `--isolated`, if that slice has landed; else leave a clean seam) path; layer ONLY `REPO_ALLOWED_KEYS` via the existing filter; restore `flag > env > per-repo > global > default`; a clear behaviour when the target repo has NO `.dorfl.json` (→ exactly today's global+default, unchanged); tests.
- OUT: changing the per-repo allow/reject SET (`REPO_ALLOWED_KEYS` is reused as-is); host-only keys becoming repo-readable (they stay rejected); the in-place `do` path (already correct); building `do-isolated-in-place` itself (separate slice — coordinate the seam if it lands first, else this fix applies to `--remote` and the `--isolated` path inherits it through the shared `performDoRemote`).

## Acceptance criteria

- [ ] `do --remote <url> <slug>` against a repo whose committed `.dorfl.json` declares `harness: pi` resolves the PI harness (no `--harness` flag, no global config) — the "no agentCmd" error no longer fires for a repo that declares `harness: pi`.
- [ ] `do --remote <url> <slug>` against a repo declaring a `verify` gate RUNS THAT gate (not `DEFAULT_VERIFY_COMMAND`) — verified by a repo whose declared gate differs from the default and would pass/fail differently (e.g. this repo's root-level `format:check`).
- [ ] The resolution chain is `flag > env > per-repo (from arbiter main) > global > default` — a `--harness`/`--verify`-equivalent flag or `DORFL_*` env STILL overrides the per-repo file (parity with in-place `do`).
- [ ] Host-only keys in the target's `.dorfl.json` (`agentCmd`, `piBin`, `sessionsDir`, `identity`) are IGNORED + reported, exactly as the in-place per-repo read rejects them (reuse `REPO_REJECTED_KEYS`; do not duplicate the split).
- [ ] A target repo with NO `.dorfl.json` resolves to global+default — byte-identical to today's `--remote` behaviour (no regression).
- [ ] In-place `do <slug>` and `do --remote <url>` for a config-less repo are behaviourally UNCHANGED.
- [ ] Tests: a throwaway repo + local `--bare` arbiter whose main carries a `.dorfl.json` (with both allowed + rejected keys); assert the allowed keys take effect on the `--remote` build, the rejected keys are ignored+reported, flag/env still override, and the no-config repo is unchanged. House pattern (temp `workspacesDir`, `isolatePiAgentDir`, stubbed harness, real shared dirs untouched).
- [ ] `pnpm format:check && pnpm build && pnpm test` green (this repo's actual gate).

## Prompt

> Make `do --remote <url> <slug>` HONOUR the target repo's committed `.dorfl.json` by reading it from the ARBITER's main and layering ONLY the whitelisted per-repo keys (`REPO_ALLOWED_KEYS`) into config resolution, restoring `flag > env > per-repo > global > default` parity with in-place `do`. Today (`src/cli.ts`, the `flags.remote !== undefined` branch) `--remote` uses `resolveGlobalConfig(global, doFlagOverrides(...))` and NEVER reads the repo file — silently dropping the repo's declared `harness`/`verify`/`provider`/`model`. Source: `work/observations/remote-do-ignores-per-repo-config.md` (READ IT FIRST; delete it when this lands). Two symptoms it caused: `harness: pi` dropped → "no agentCmd configured"; the repo's `verify` dropped → the default `pnpm -r format:check` false-reds a repo that runs `format:check` at root.
>
> APPROACH: prefer reading the committed file from the bare hub mirror up front (`git show <arbiter>/main:.dorfl.json` after `ensureMirror`), parsed+filtered through the EXISTING `src/repo-config.ts` machinery (`loadRepoConfig`/`resolveRepoConfig`, reusing `REPO_ALLOWED_KEYS`/`REPO_REJECTED_KEYS` — do NOT reimplement the allow/reject split), then feed it into the resolution that wires harness/verify/gate — so the up-front CLI wiring stays intact. If that's awkward, resolve from the job worktree after it's cut (faithful, but defers the wiring). Record the choice in a `## Decisions` block. The ONLY genuinely new logic is sourcing the bytes from the arbiter instead of cwd.
>
> READ FIRST: `src/cli.ts` the `do --remote` branch (the `resolveGlobalConfig` call to augment) + the in-place `do` branch (the `resolveRepoConfig(cwd,…)` it should mirror); `src/repo-config.ts` (`REPO_ALLOWED_KEYS`, `REPO_REJECTED_KEYS`, `loadRepoConfig`, `resolveRepoConfig` — reuse, don't duplicate); `src/do.ts` `performDoRemote` (the `ensureMirror` + job-worktree materialisation where the arbiter main is reachable); `src/repo-mirror.ts` (`ensureMirror`). Host-only keys stay rejected; flag/env still win; a config-less target repo stays byte-identical to today.
>
> TDD with vitest, house style (throwaway repo + local `--bare` arbiter whose main carries a `.dorfl.json` with allowed + rejected keys; temp `workspacesDir`; `isolatePiAgentDir`; real shared dirs untouched). "Done" = the repo's declared harness + verify take effect on a `--remote` build, host-only keys are ignored+reported, flag/env override, a config-less repo is unchanged, and `pnpm format:check && pnpm build && pnpm test` is green.

---

### Claiming this slice

```sh
dorfl claim remote-do-reads-per-repo-config-from-arbiter-main --arbiter origin
git fetch origin && git switch -c work/remote-do-reads-per-repo-config-from-arbiter-main origin/main
git mv work/in-progress/remote-do-reads-per-repo-config-from-arbiter-main.md work/done/remote-do-reads-per-repo-config-from-arbiter-main.md
```
