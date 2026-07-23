---
title: 'config env layer — DORFL_* env vars in the resolution chain'
slug: config-env-layer
spec: dorfl
blockedBy: []
covers: []
---

## What to build

Add an **environment-variable layer** to config resolution so a CI job (or any per-machine context) can set ANY config key without a committed file — including the **host-only** keys (`piBin`, `agentCmd`, `roots`, …) that the per-repo file deliberately rejects. This de-risks the future `runner-in-ci` SPEC (which needs per-job config) and lets `agent-model-config` get env support for `model` for free.

New resolution chain (highest wins):

```
flag  >  ENV (DORFL_*)  >  per-repo dorfl.json  >  global ~/.config/dorfl/config.json  >  built-in default
```

Key design (decided — do not relitigate):

- **Env covers ALL `Config` keys**, host-only AND repo-appropriate. Env is a legitimate _per-machine source_ (like the global file / a flag), so it is NOT subject to the per-repo allow/reject split — that split only governs the _committed repo file_. This sharpens the principle: **host-only keys must come from a per-machine source (flag, env, or global file) — never the committed repo file**; env is simply the per-machine source CI actually has without writing a file. (Update ADR §13 + the repo-config doc to state this.)
- **Naming: `DORFL_<SCREAMING_SNAKE(key)>`** — mechanical camelCase → SCREAMING*SNAKE, prefix `DORFL*`(matches the binary). Examples:`DORFL_AGENT_CMD`, `DORFL_PI_BIN`, `DORFL_DEFAULT_ARBITER`, `DORFL_ALLOW_AGENTS`, `DORFL_PER_REPO_MAX`, `DORFL_MODEL`.
- **Typed coercion per key, reject invalid LOUDLY** (never silently ignore a typo): booleans (`true`/`false` only — else error), numbers (reject NaN), enums (validate against the union, e.g. `integration` ∈ {propose, merge}), string lists split on **comma** (cross-platform; not `:`), plain strings verbatim.
- **Slots into the existing chain without disturbing floors:** e.g. `piBin` resolves flag > `DORFL_PI_BIN` > (repo: rejected) > global > built-in `'pi'` (`DEFAULT_PI_BIN` stays the floor). The global `.config` file still works in CI — env is additive, not a replacement.

## Acceptance criteria

- [ ] An `DORFL_*` env var sets its config key, resolving ABOVE per-repo + global but BELOW an explicit flag.
- [ ] Env sets host-only keys (`piBin`, `agentCmd`, `roots`, `maxParallel`) that the per-repo file rejects — proving env is a valid per-machine source.
- [ ] Typed coercion: booleans accept only `true`/`false` (else a clear error), numbers reject NaN, enums validate, list keys split on comma; invalid values fail loudly with a message naming the offending var.
- [ ] Built-in defaults/floors are unchanged when no env var is set (e.g. `piBin` still defaults to `pi`).
- [ ] A global `.config` file still works (env is additive).
- [ ] Tests cover: precedence position in the chain, host-only-via-env, each coercion type + an invalid-value rejection, and no-env regression. `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — extends the existing `config`/`repo-config` resolution; nothing else needs to land first. (`agent-model-config` is blockedBy THIS so `model` inherits env uniformly.)

## Prompt

> Add an environment-variable layer to `dorfl` config resolution. READ FIRST: `src/config.ts` (`Config`, `mergeConfig`, `loadConfig`, `DEFAULT_CONFIG`), `src/repo-config.ts` (`resolveRepoConfig`, `REPO_ALLOWED_KEYS`/ `REPO_REJECTED_KEYS` — note the per-repo allow/reject split), the CLI flag plumbing in `src/cli.ts`, and `docs/adr/execution-substrate-decisions.md` §13 (the host-only = per-machine-source principle to extend).
>
> Implement the chain `flag > ENV (DORFL_*) > per-repo > global > default`. Env vars are named `DORFL_<SCREAMING_SNAKE(key)>` and may set ANY `Config` key (host-only included — env is a per-machine source, NOT subject to the repo allow/reject split). Coerce per the key's type and FAIL LOUDLY on invalid input (booleans = `true`/`false` only; numbers reject NaN; enums validate against their union; list keys split on comma; strings verbatim), with a message naming the offending variable. Do not change built-in floors/defaults when no env is set. Keep the global `.config` file working (env is additive). Update ADR §13 and the repo-config doc to state the sharpened principle: host-only keys come from a per-machine source (flag/env/global file), never the committed repo file.
>
> TDD with vitest: precedence position, host-only-via-env, each coercion type + an invalid-value rejection, and a no-env regression. Match house style. "Done" = acceptance criteria met and the gate is green.
