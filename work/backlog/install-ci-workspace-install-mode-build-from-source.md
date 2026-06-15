---
title: install-ci should support a WORKSPACE install mode (build the CLI from source + link it onto PATH) for the self-hosting agent-runner repo, instead of `npm install -g agent-runner` which fails (127, command not found) because agent-runner is not published — mirroring whitesmith's `dev` mode, auto-detected when generating inside the agent-runner monorepo
slug: install-ci-workspace-install-mode-build-from-source
blockedBy: []
covers: []
---

## What to build

The composite setup action emitted by `install-ci` (`generateSetupAction` in `src/install-ci-core.ts`, written to `.github/actions/agent-runner-setup/action.yml`) installs the CLI with `npm install -g agent-runner`. In the **agent-runner repo itself** this FAILS at runtime: agent-runner is not published to that npm name, so every CI job that calls the CLI dies with `agent-runner: command not found` / exit code 127 (observed on the first push of the close-job workflow). The repo is self-hosting: it is both the AUTHOR and a USER of its own CI, so it must build the CLI from its own checked-out source rather than pull it from a registry.

Add a **workspace install mode** (the agent-runner analogue of whitesmith's `dev` mode, see `~/dev/github/wighawag/whitesmith/src/providers/github-ci.ts`) to `install-ci`:

- A new resolved-config field (e.g. `installSource: 'registry' | 'workspace'`, default `'registry'`) carried on `ResolvedCIConfig` (and the serializable `CIConfigFile`, optional) in `src/install-ci-core.ts`. `resolveCIConfig` defaults a MISSING `installSource` to `'registry'` (a pure `CIConfigFile → ResolvedCIConfig` map with no I/O — exactly like `harness: file.harness ?? DEFAULT_HARNESS` today).

> SEAM SPLIT (verified against the code — do not re-derive): the FIELD DEFAULT and the AUTO-DETECTION live in DIFFERENT functions. `resolveCIConfig(file)` (`install-ci-core.ts` ~L407) is a PURE map with NO `workDir`, so it CANNOT read a `package.json` — it only does the `?? 'registry'` default. The AUTO-DETECTION (reading `<workDir>/package.json`) MUST live in the orchestrator `installCI` (`src/install-ci.ts`), which has `options.ctx.workDir`. This mirrors whitesmith, where the `dev` auto-detect lives in its `installCI` equivalent and folds `dev` into the config object BEFORE `generateSetupAction`. Do NOT attempt package.json I/O inside `resolveCIConfig` (no `workDir` there).
- `generateSetupAction(config)` branches on it. `registry` keeps the current `npm install -g agent-runner` + harness install (UNCHANGED — the default for every consumer repo). `workspace` instead emits the build-from-source steps:

```yaml
    - name: Setup pnpm
      uses: pnpm/action-setup@v4

    - name: Add pnpm global bin to PATH
      shell: bash
      run: |
        pnpm setup
        echo "$HOME/.local/share/pnpm" >> "$GITHUB_PATH"

    - name: Install dependencies and build agent-runner
      shell: bash
      run: |
        pnpm install
        pnpm -r build
        pnpm --filter agent-runner link --global
```

  followed by a pnpm-flavoured harness install step — `pnpm add -g @mariozechner/pi-coding-agent` — so it lands on the pnpm global bin already on `$GITHUB_PATH` (matching whitesmith). NOTE: the existing `harnessInstallStep` helper (`install-ci-core.ts` ~L452) hard-codes `npm install -g @mariozechner/pi-coding-agent`, so workspace mode needs its OWN pnpm-flavoured harness step (or `harnessInstallStep` gains an install-source param) — it cannot reuse the helper verbatim. The auth/models.json (and auth.json/OAuth-refresh) steps, the git-identity step, and `actions/setup-node@v4` are UNCHANGED and shared by both modes.

  > MONOREPO NOTE (differs from whitesmith, which is a single package): agent-runner is a pnpm workspace. The build is `pnpm -r build` (not `pnpm run build`) and the link must target the CLI package specifically — `pnpm --filter agent-runner link --global` — because the root package is `agent-runner-monorepo` and only `packages/agent-runner` exposes the `agent-runner` bin (`packages/agent-runner/package.json` → `"bin": {"agent-runner": "dist/cli.js"}`). Verify the exact filter/link incantation builds and links a working `agent-runner` on PATH before pinning it.

- **Auto-detection** (mirrors whitesmith ~L992-1003): in the orchestrator `installCI` (`src/install-ci.ts`), if `installSource` was not explicitly provided (flag/config), read `<options.ctx.workDir>/package.json` and select `workspace` when it is the agent-runner monorepo, then fold that into the resolved config BEFORE calling `generateSetupAction`. Whitesmith keys off `pkg.name === 'whitesmith'`; here the root package is `agent-runner-monorepo`, so detect that name (a single, exact-name check — do NOT fuzzy-match "agent-runner" or it would wrongly trip in a consumer repo that happens to be named similarly). Wrap the read in try/catch and treat a missing/unparseable `package.json` as `registry` (whitesmith swallows the error). Log a one-line notice when auto-detected (e.g. `📦 Detected agent-runner monorepo — using workspace install mode (build from source)`), matching whitesmith's UX.
- A CLI flag on `install-ci` to force it both ways (e.g. `--workspace` / `--registry`, or `--install-source <registry|workspace>`), so the auto-detection can be overridden, and it round-trips through `--config` / `--export-config` like the other config fields. Add the flag to `InstallCiFlags` in `src/cli.ts` and thread it into `installCI`.

This is the config-knob feature only. The human will RE-RUN `agent-runner install-ci` in this repo afterwards to regenerate `.github/actions/agent-runner-setup/action.yml` with the workspace steps — do NOT hand-edit the committed action.yml as part of this slice (it is generated; re-running install-ci is the supported path, per the "DO NOT hand-edit a copy — re-run install-ci" banners in the emitted files).

## Acceptance criteria

- [ ] `ResolvedCIConfig` carries an `installSource` (`'registry' | 'workspace'`), and `CIConfigFile` carries it as an optional field that resolves to `'registry'` when absent. A test pins the default-to-registry resolution.
- [ ] `generateSetupAction` with `installSource: 'registry'` is BYTE-IDENTICAL to today's output (`npm install -g agent-runner` + `npm install -g @mariozechner/pi-coding-agent`). The existing `install-ci.test.ts` assertions for the registry path still pass unchanged.
- [ ] `generateSetupAction` with `installSource: 'workspace'` emits NO `npm install -g agent-runner`; instead emits `pnpm/action-setup@v4`, the `pnpm setup` + `$GITHUB_PATH` step, `pnpm install`, `pnpm -r build`, `pnpm --filter agent-runner link --global`, and the harness via `pnpm add -g @mariozechner/pi-coding-agent`. A test pins each of these strings.
- [ ] Both modes still emit the SAME auth step (models.json default; auth.json + OAuth-refresh when `authMode: 'auth-json'`), git identity, and `actions/setup-node@v4`. A test pins that the auth/identity steps are mode-independent.
- [ ] `installCI` auto-detects `workspace` when `<workDir>/package.json` has `name === 'agent-runner-monorepo'` and `installSource` was not explicitly provided; it stays `registry` for any other repo (including a missing/unparseable package.json). Tests pin BOTH: detection trips in the monorepo fixture, and does NOT trip for a fixture named anything else.
- [ ] The explicit flag/config value WINS over auto-detection in both directions (force `registry` inside the monorepo; force `workspace` elsewhere). A test pins the override precedence.
- [ ] `exportCIConfig` (`install-ci-core.ts` ~L423) is taught to emit `installSource` (its output `CIConfigFile` is built from a FIXED field list today that omits it — add it), and `loadCIConfigFile`/`resolveCIConfig` read it back. An EXPLICIT `installSource` round-trips through `--export-config` → `--config` (export then re-load yields the same resolved mode). A test pins the explicit round-trip.
- [ ] AUTO-DETECTED `installSource` is NOT baked into `--export-config` (matching whitesmith, whose `dev` auto-detect runs AFTER the export-config early-return): `--export-config` reflects only the EXPLICIT value (default `registry` when neither flag nor config set it), so re-running `install-ci` from an exported config in a different repo does not silently inherit the monorepo's workspace mode. A test pins that an export from the monorepo with no explicit flag yields `registry` (or omits the field), not `workspace`.
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None.

## Prompt

> FIRST, drift-check + reference read: open `~/dev/github/wighawag/whitesmith/src/providers/github-ci.ts` and read its `dev` field (~L38), the dev-mode `installSteps` branch (~L345-389: `pnpm/action-setup@v4`, `pnpm setup` + `$GITHUB_PATH`, `pnpm install` + `pnpm run build` + `pnpm link --global`, `pnpm add -g` for pi), and the dev auto-detection (~L992-1003: reads `package.json`, sets dev when `pkg.name === 'whitesmith'`, logs a notice). Then read this repo's `src/install-ci-core.ts` (`generateSetupAction`, `harnessInstallStep` ~L452, `ResolvedCIConfig`, `CIConfigFile`, `resolveCIConfig` ~L407, `exportCIConfig` ~L423 + its FIXED output field list, `loadCIConfigFile` ~L363), `src/install-ci.ts` (`installCI` — note the `--export-config` EARLY-RETURN at step 2, and `options.ctx.workDir`), `src/cli.ts` (`InstallCiFlags` ~L668 + the `install-ci` command ~L3163), and `test/install-ci.test.ts` (the existing `generateSetupAction` registry assertions you must keep green). Confirm the monorepo root name is `agent-runner-monorepo` and the CLI package is `agent-runner` with the `agent-runner` bin (it is: root `package.json` + `packages/agent-runner/package.json`). If a workspace/dev install mode already exists, route to needs-attention noting that.
>
> GOAL: give `install-ci` a `workspace` install mode that builds the CLI from the checked-out source and links it onto PATH (so the self-hosting agent-runner repo stops failing with `agent-runner: command not found`), auto-detected when generating inside the agent-runner monorepo, overridable by an explicit flag/config value, defaulting to the UNCHANGED `registry` (`npm install -g`) mode everywhere else. Mirror whitesmith's `dev` mode but adapt to the pnpm WORKSPACE: `pnpm -r build` and `pnpm --filter agent-runner link --global` (NOT `pnpm run build` + bare `pnpm link --global`). Verify the link incantation actually produces a runnable `agent-runner` before pinning it in a test/string.
>
> SEAM SPLIT + EXACT PLACEMENT (verified against `install-ci.ts` — do not re-derive): `installCI` computes `const config = resolveCIConfig(file)` at STEP 1 (~L116); STEP 2 (~L118) is the `--export-config` EARLY-RETURN, which exports THAT `config` via `exportCIConfig(config, …)`; STEP 5 (~L182) calls `buildSetupArtifacts(config, …)` (which calls `generateSetupAction`). So: put the `?? 'registry'` field default in the PURE `resolveCIConfig` (no `workDir` there). Apply the package.json AUTO-DETECTION (using `options.ctx.workDir`) AFTER the step-2 early-return and BEFORE step 5 — overriding `config.installSource` only when no explicit flag/config value was given. Do NOT fold auto-detect into `config` at step 1, or it would LEAK into the exported config (step 2 exports the same `config`). Teach `exportCIConfig` to emit the new field so an EXPLICIT value round-trips; auto-detect, placed after step 2, is correctly excluded from the export (matching whitesmith, which detects after its export-config return for exactly this reason).
>
> SEAM TO TEST AT: `generateSetupAction(config)` for both `installSource` values (string assertions: registry path byte-identical to today incl. the `npm install -g` harness step; workspace path emits `pnpm/action-setup@v4`, `pnpm setup`+`$GITHUB_PATH`, `pnpm install`, `pnpm -r build`, `pnpm --filter agent-runner link --global`, `pnpm add -g @mariozechner/pi-coding-agent`, and NO `npm install -g agent-runner`; auth/identity/setup-node steps identical in both). Auto-detection in `installCI` with fixture repos (package.json named `agent-runner-monorepo` ⇒ workspace; named otherwise / missing / unparseable ⇒ registry; explicit flag/config overrides BOTH directions). EXPLICIT `installSource` round-trips through `--export-config` → `--config`; AUTO-DETECTED `workspace` is NOT baked into the export (export from the monorepo with no explicit flag ⇒ `registry`/omitted). No network, no real `gh` (stub the provider seam as the existing tests do).
>
> DONE: registry is the unchanged default for consumer repos, workspace builds-from-source for the monorepo (auto-detected, flag-overridable), the existing registry-path tests still pass, and `pnpm -r build && pnpm -r test && pnpm format:check` passes. Do NOT hand-edit the committed `.github/actions/agent-runner-setup/action.yml` (it is generated; the human will re-run `install-ci`). Do NOT perform git transitions (no stage/commit/push, no folder moves) — the runner/human owns those.
