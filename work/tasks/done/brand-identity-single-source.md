---
title: Centralize the brand/protocol identity in one source (env prefix, config filename, workdir, bin)
slug: brand-identity-single-source
blockedBy: [config-env-layer]
covers: []
---

## What to build

> Self-contained chore/refactor — derives from NO SPEC (`covers: []`), so per WORK-CONTRACT.md's `spec` rule it omits `prd:` and is its own source of truth.

Make the **load-bearing protocol identity** of dorfl derive from a SINGLE source-of-truth module, so that renaming the project later changes one base string instead of risking a missed, silently-breaking occurrence (a missed env var fails silently — the worst kind). The name is very likely to change; this de-risks that.

Centralize ONLY the **protocol/contract surface** — the strings that are a contract with the user / filesystem / CI and that BREAK if inconsistent — derived from one base identity (`dorfl`) via the standard case transforms:

- the **`DORFL_` env-var prefix** (constantCase of the base + `_`) — today built/spread across `env-config.ts` / `repo-config.ts` / `harness.ts`;
- the **`.dorfl.json` per-repo config filename** (`REPO_CONFIG_FILENAME` in `repo-config.ts`);
- the **`~/.dorfl/` workspaces dir default** — hardcoded in `workspace.ts`, `work-on.ts`, `gc.ts`;
- the **binary / package name** (`dorfl`) where referenced from code (not the `package.json` `name`/`bin` themselves — those are renamed by the tool below, not indirected through a runtime constant).

A new identity module exposes the base name + its derived forms (e.g. `BRAND` / `brand.envPrefix`, `brand.repoConfigFilename`, `brand.workdirName`, `brand.bin`), computed from ONE base string using the same case conventions the `change-name` tool understands. All the sites above import from it; no behaviour changes (the derived strings are byte-identical to today's literals).

**Explicitly OUT OF SCOPE: the ~600 cosmetic doc/prose mentions** of "dorfl" (ADRs, PRDs, CONTEXT.md, slices, comments). Those should read as the real name, not be indirected through a constant — they are handled at actual rebrand time by the `change-name` tool (https://github.com/wighawag/change-name), which does multi-case-aware recursive rename of file names + contents. This slice centralizes the _protocol surface_ (where a miss BREAKS things); `change-name` covers the _cosmetic bulk_ (where a miss is merely stale text). The two are complementary, not competing.

## Acceptance criteria

- [ ] A single identity module is the source of truth for the base name and its derived protocol forms (env prefix, repo-config filename, workspaces-dir name, bin name).
- [ ] The `DORFL_` env prefix, `.dorfl.json` filename, and `~/.dorfl/` default are all DERIVED from that module (no remaining hardcoded literals of these at the derivation sites in `src/`).
- [ ] Changing ONLY the base string in the module changes every derived protocol surface consistently (a test demonstrates this: e.g. derive with a different base and assert prefix/filename/workdir all change in lockstep).
- [ ] Behaviour is byte-identical with the current base name: existing config/env/workspace/gc/work-on tests pass UNCHANGED (the derived strings equal today's literals).
- [ ] Cosmetic doc/prose mentions are NOT touched; `package.json` `name`/`bin` are NOT indirected through a runtime constant (left for `change-name`).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

## Blocked by

- `config-env-layer` — it just introduced the `DORFL_*` env layer (`env-config.ts`) and reshaped `repo-config.ts`; this slice centralizes the prefix it established, so it must land first (also avoids editing the same files concurrently).

## Prompt

> Centralize dorfl's **protocol/brand identity** behind a single source-of-truth module so a future rename is one change, not a scattered (and silently-breakable) find/replace. PURE REFACTOR — observable behaviour must be byte-identical (the derived strings equal today's literals).
>
> READ FIRST: `src/env-config.ts` + `src/repo-config.ts` (the `DORFL_*` env prefix + `REPO_CONFIG_FILENAME = '.dorfl.json'`), `src/workspace.ts` / `src/work-on.ts` / `src/gc.ts` (the `~/.dorfl` workspaces-dir default), `src/harness.ts` (an `DORFL_MODEL` mention), and `packages/dorfl/ package.json` (`name`/`bin` = `dorfl`). Also `skills/to-slices/WORK- CONTRACT.md` (this is a contract-sanctioned SPEC-less chore slice).
>
> Create one identity module exposing a BASE name and its derived protocol forms (env-var prefix = constantCase + `_`; repo-config filename `.{base}.json`; workspaces-dir name `.{base}`; bin/package name) computed from the single base string, using the case conventions the `change-name` tool understands (camelCase/constantCase/paramCase/etc — https://github.com/wighawag/change-name). Replace the scattered literals at the DERIVATION SITES in `src/` with imports from it. Add a test proving that changing only the base string flips every derived surface in lockstep, and that with the current base the derived strings equal today's literals.
>
> DO NOT touch cosmetic doc/prose mentions of "dorfl" (ADRs, PRDs, CONTEXT.md, slices, comments) — those are handled by `change-name` at rebrand time, not indirected through a constant. DO NOT indirect `package.json` `name`/`bin` through a runtime constant (also `change-name`'s job). Keep it to the protocol surface where inconsistency BREAKS things.
>
> TDD with vitest, house style. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim brand-identity-single-source --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/brand-identity-single-source <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/brand-identity-single-source.md work/done/brand-identity-single-source.md
```
