---
title: 'remove the deprecated allowAgents -> autoBuild config alias and its machinery (no external users yet, so no deprecation window is owed)'
slug: remove-deprecated-config-aliases
blockedBy: []
covers: []
---

> Self-contained CLEANUP slice (`covers: []`, no `prd:`). Source: decision 2026-06-12 (this repo has no external users yet, so deprecation aliases are pure ceremony). Independent of the gate slices; can run in parallel with `observation-triage-tri-state-gate` EXCEPT both touch `config-alias.ts`/`env-config.ts`/`cli.ts`, so SERIALISE if built concurrently (see Decisions).

## What to build

Delete the deprecated `allowAgents -> autoBuild` config-key alias and ALL its supporting machinery, since there is no external user owed a migration window. After this slice, `allowAgents` (the key, the env var `DORFL_ALLOW_AGENTS`, and the `--allow-agents`/`--no-allow-agents` flags) is simply GONE; only `autoBuild` remains.

The alias spans several files (verified 2026-06-12):

- `config-alias.ts`: `CONFIG_KEY_ALIASES` (the `{oldKey:'allowAgents', newKey:'autoBuild'}` entry), and the now-unused `applyConfigKeyAliases` / `aliasDeprecationMessage` / `coercionForAlias` / `legacyEnvVarName` machinery (remove what becomes dead once the only alias is gone; keep the module only if something still needs it, otherwise delete it).
- `config.ts`: the `applyConfigKeyAliases` call in `loadConfig` (~L387) + its doc mention.
- `repo-config.ts`: the `applyConfigKeyAliases` call (~L217) + doc mention.
- `env-config.ts`: the legacy-alias loop in `envOverrides` (~L195) + `legacyEnvVarName`/`coercionForAlias`.
- `cli.ts`: the `allowAgents?` flag field (~L97), the `getOptionValueSource('allowAgents')` branch in the auto-build source-detection (~L123), and the two `--allow-agents`/`--no-allow-agents` option registrations (~L743, ~L832) + the help text mentioning the deprecated alias.

This is a DESIGN STANCE for the repo, not just this alias: while there are no external users, config renames are CLEAN REPLACEMENTS (no alias). The sibling `observation-triage-tri-state-gate` slice applies the SAME stance (it deletes `autoTriage` outright). Record the stance so future renames do not reflexively add an alias.

## Acceptance criteria

- [ ] `allowAgents` is fully removed: no `CONFIG_KEY_ALIASES` entry, no `--allow-agents`/`--no-allow-agents` flags, no `DORFL_ALLOW_AGENTS` env handling. Only `autoBuild` (`--auto-build`, `DORFL_AUTO_BUILD`, the `dorfl.json` key) remains.
- [ ] Any machinery that becomes DEAD once the last alias is gone (`applyConfigKeyAliases`, `aliasDeprecationMessage`, `coercionForAlias`, `legacyEnvVarName`, and the `CONFIG_KEY_ALIASES`-iterating loops) is removed, NOT left as unused code. If the whole `config-alias.ts` module becomes empty, delete it and its imports. (Cleanup-vs-behaviour: confirm nothing else still depends on these before deleting.)
- [ ] Tests that asserted the deprecated-alias behaviour are removed (not skipped); no test still references `allowAgents`/`DORFL_ALLOW_AGENTS`/`--allow-agents`.
- [ ] A config file or env using `allowAgents` now does whatever an UNKNOWN key does (it is no longer specially handled), confirm that is the existing unknown-key behaviour (ignored or rejected per the repo's contract), not a crash.
- [ ] No shared/global location is written outside temp fixtures by any new/changed test.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None, can start immediately. (If built CONCURRENTLY with `observation-triage-tri-state-gate`, serialise: both edit `config-alias.ts`/`env-config.ts`/`cli.ts`. See Decisions.)

## Decisions (to record while building)

- Whether `config-alias.ts` is DELETED entirely or kept as an empty-registry scaffold for the NEXT rename. Given the repo stance "no alias while no external users", deleting it is cleanest; if kept, it must be genuinely dead (an empty `CONFIG_KEY_ALIASES` + no callers) so it cannot silently re-activate.
- Build ORDER vs `observation-triage-tri-state-gate`: that slice also removes a config key (`autoTriage`) and edits the same files. If both are in flight, land one then rebase the other (they do not logically depend, but they conflict). Record which order was taken.

## Prompt

> Delete the deprecated `allowAgents -> autoBuild` config alias and its machinery. This repo has NO external users yet (decided 2026-06-12), so a deprecation window is pure ceremony, config renames here are clean replacements. After this slice only `autoBuild` exists.
>
> FIRST, drift-check + map the surface (it spans files): `config-alias.ts` (`CONFIG_KEY_ALIASES` = `[{oldKey:'allowAgents', newKey:'autoBuild'}]`, plus `applyConfigKeyAliases`/`aliasDeprecationMessage`); `config.ts` + `repo-config.ts` (the `applyConfigKeyAliases` calls); `env-config.ts` (the legacy-alias loop + `legacyEnvVarName`/`coercionForAlias`); `cli.ts` (the `allowAgents?` flag, the `getOptionValueSource('allowAgents')` branch, the `--allow-agents`/`--no-allow-agents` registrations + help). Confirm each before deleting; if something landed differently, reconcile or route to `needs-attention/`.
>
> CLEANUP-vs-BEHAVIOUR DISCIPLINE: this is a removal, so the risk is hidden live behaviour. Confirm nothing reads the alias machinery for any purpose OTHER than the `allowAgents` mapping before deleting it. Remove dead code, do not leave unused exports. If `config-alias.ts` becomes empty, delete the module + its imports (record the choice).
>
> BUILD: remove the alias entry, the now-dead machinery, the CLI flag + source-detection branch + help, and the env legacy path. Remove the tests that asserted the deprecated behaviour (delete, don't skip).
>
> TEST: no test references `allowAgents`/`DORFL_ALLOW_AGENTS`/`--allow-agents`; `autoBuild` still resolves through the full `flag > env > per-repo > global > default` chain unchanged; a config with `allowAgents` falls through to the normal unknown-key behaviour (not a crash). House style; isolate shared/global locations.
>
> "Done" = `allowAgents` is gone everywhere, dead machinery removed, `autoBuild` unaffected, no stale tests, and the gate is green.
