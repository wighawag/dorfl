---
title: per-machine config override layer — global config.override.json above committed repo config
slug: per-machine-config-override-layer
prd: agent-runner
blockedBy: []
covers: []
---

## What to build

Add ONE new **per-machine override layer**, sourced from the global config dir as
`<configDir>/config.override.json` (sibling of `config.json`), that overrides the
COMMITTED per-repo `.agent-runner.json` but is itself overridden by env and flags.
This gives the laptop a stable, high-precedence per-machine lever symmetric to
CI's `AGENT_RUNNER_*` env, fixing "I cannot make this checkout override what the
repo committed without an env var whose setting depends on where I invoke from."

READ FIRST: `docs/adr/per-machine-config-override-layer.md` (the full decision).
This task implements it.

### New precedence chain

```
flag > ENV (AGENT_RUNNER_*) > override:per-repo > override:global("*") > per-repo committed > global > default
```

The committed-repo-beats-global rule and global's position are UNCHANGED; the new
layer slots BETWEEN env and the committed per-repo file.

### File shape (one file, hub-keyed, `"*"` global bucket)

```json
{
  "*": { "autoBuild": false },
  "github-com/wighawag/agent-runner": { "integration": "merge" }
}
```

- **Repo key = the HUB KEY** from `encodeRepoKey(arbiterUrl)` (`repo-mirror.ts`),
  e.g. `github-com/wighawag/agent-runner`. NOT a filesystem path — this is the
  load-bearing choice that makes the override survive the hub-mirror + job-worktree
  substrate (a path-keyed or gitignored file would be invisible to runner jobs).
- **`"*"`** is the global-default override bucket (all repos on this machine). A
  specific hub-key entry beats `"*"` (most-specific-first), mirroring
  committed-repo-beats-global one level down.

### Resolution (sparse / shallow merge)

Insert the override as two more spread layers in the existing per-key shallow merge,
in `resolveRepoConfigFromLoaded` (the source-agnostic core both
`resolveRepoConfig` and `do --remote` feed):

The current core is `mergeConfig({...global, ...repo.config, ...envOverrides(env),
...(flags ?? {})})`. Insert the override spreads BETWEEN `repo.config` and
`envOverrides(env)`:

```
mergeConfig({
  ...global,
  ...repo.config,              // committed per-repo (host-only already stripped)
  ...override["*"],            // override: all-repos bucket
  ...override[hubKey],         // override: this-repo (beats "*")
  ...envOverrides(env),        // NOTE: the COERCED PartialConfig, not the raw EnvMap
  ...(flags ?? {}),
})
```

Keep `envOverrides(env)` exactly as today (it coerces the `AGENT_RUNNER_*` vars);
do NOT spread the raw `env` map. An override touches ONLY the keys it lists;
unlisted keys resolve through the rest of the chain (this is the existing
shallow-merge behaviour, not a new rule).

Fallback keys compose for free: `slicingIntegration ?? integration` (and peers)
fall back at their READ site against the POST-merge `config`, so an override that
sets `integration` is inherited by an unset `slicingIntegration` with no special
handling needed.

### May set ANY key (host-only included)

The override file is a PER-MACHINE source (same class as env / flag / global file),
so the sharpened host-only principle (`execution-substrate-decisions.md` §13) is
satisfied: it may set ANY `Config` key, host-only included (`piBin`, `agentCmd`,
…). It is NOT subject to the `REPO_ALLOWED_KEYS`/`REPO_REJECTED_KEYS` split — that
split governs only the committed repo file.

### THREE resolution paths, ONE merge point (discovered, not optional)

There are THREE per-repo resolution entry points, and ALL must apply the override
(missing any one means the override silently does not apply there). They funnel
through a single merge core, but each supplies the hub key from a DIFFERENT URL
source:

1. **Working-tree path** — `resolveRepoConfig({repoPath, ...})` (`cli.ts`,
   `scan.ts:495`). It knows `repoPath` + an arbiter remote NAME
   (`config.defaultArbiter`, e.g. `origin`), not a URL. Obtain the URL with
   `git -C <repoPath> remote get-url <arbiter>` — REUSE
   `resolveArbiterUrlFromCheckout(cwd, arbiter, env)` (`do.ts` ~L1614), which
   already returns the URL or `undefined`.
2. **No-checkout / mirror path** — `resolveRepoConfigFromMirror({mirrorPath, ...})`
   (`repo-mirror.ts`, used by `scan.ts:397,424` — the autonomous/CI enumeration
   path). There is NO working tree here; read the mirror's own `origin` URL
   (`git -C <mirrorPath> remote get-url origin`), which is the MORE RELIABLE
   source for this path. NOTE: `registry.ts` has `readOriginUrl(mirrorDir, env)`
   doing exactly this but it is currently FILE-PRIVATE (not exported) — export it
   (or add a small exported helper) rather than duplicating the `git` call.
3. **`do --remote` path** — `resolveRemoteRepoConfig` (`cli.ts:256`) feeds
   `resolveRepoConfigFromLoaded` directly from the arbiter's committed file; it
   already has the arbiter URL in hand — pass it through.

All three converge on **`resolveRepoConfigFromLoaded`** — that is the ONE place
the `...override["*"]` and `...override[hubKey]` spread layers are inserted. Thread
the (optional) resolved arbiter URL into `resolveRepoConfigFromLoaded` (and its
options) so the merge core can compute `encodeRepoKey(url)`; each of the three
callers supplies the URL from its own source above.

DEGRADE GRACEFULLY everywhere: if the URL cannot be resolved (no remote,
`--bare`/local arbiter, detached context), the hub-key lookup is simply SKIPPED
and the `"*"` bucket still applies — never an error. The override file being absent
is likewise a no-op (resolves to exactly today's behaviour). Invalid JSON in the
override file FAILS LOUDLY (like the other config readers), naming the file.

### Test isolation (mandatory — the file lives in the real config dir)

The override reader reads `<configDir>/config.override.json` = a REAL
`~/.config/agent-runner/` path. `defaultConfigPath()` (`config.ts`) currently
hard-codes `homedir()` with NO injection seam. So the reader MUST be designed with
an injectable path (mirroring `loadConfig(path = defaultConfigPath())`): tests
point it at a temp/scratch file and NEVER touch the real `~`. A test that reads the
real config dir is a contract violation (shared-location isolation, WORK-CONTRACT).

NOT in scope: a `ci: {}`/`runner: {}` config split (explicitly rejected, ADR §5);
a `--profile interactive|unattended` axis (deferred, ADR §5); reversing
global-vs-per-repo precedence (rejected). Do NOT add env vars for the override file
itself — env already sits above it.

## Acceptance criteria

- [ ] `<configDir>/config.override.json` is read; a specific hub-key entry overrides the committed `.agent-runner.json`, and `"*"` overrides it for repos with no specific entry. A specific entry beats `"*"`.
- [ ] ALL THREE resolution paths apply the override: working-tree (`resolveRepoConfig`), no-checkout mirror (`resolveRepoConfigFromMirror`, the scan/CI path), and `do --remote` (`resolveRemoteRepoConfig`). Each supplies the hub-key URL from its own source (checkout `git remote get-url <arbiter>`; mirror `origin` URL; `--remote` the passed URL). Verified the override applies in the scan/mirror path specifically (a regression here is silent).
- [ ] The override reader takes an INJECTABLE path (not a hard-coded `homedir()`); tests use a temp/scratch override file and assert the real `~/.config/agent-runner/` is never read or written. No test touches the real config dir.
- [ ] Sparse merge verified: an override that sets only one field leaves all other fields resolving through the rest of the chain.
- [ ] Full precedence verified end-to-end: `flag > env > override:per-repo > override:global("*") > committed per-repo > global > default` (a flag and an env var each still win over the override; the override still beats the committed repo file).
- [ ] Host-only keys (e.g. `piBin`) ARE honoured from the override file (per-machine source), unlike the committed repo file which rejects them.
- [ ] Hub key derives from the arbiter URL via `encodeRepoKey`; the URL is obtained from `git remote get-url <defaultArbiter>` at the resolution site.
- [ ] Graceful degrade: no override file ⇒ unchanged behaviour; URL unresolvable ⇒ hub-key lookup skipped but `"*"` still applies (no error); invalid JSON in the override file ⇒ loud failure naming the file.
- [ ] Multi-repo independence preserved: repo A and repo B resolve their own override entries in the same run; the shared `global` object is never mutated.
- [ ] `pnpm format` run, then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Prompt

> Implement the per-machine config override layer in `agent-runner` per the ADR. READ FIRST: `docs/adr/per-machine-config-override-layer.md` (the whole decision + rationale), plus `docs/adr/execution-substrate-decisions.md` §2 (hub-mirror + job-worktree substrate — why a path/gitignored file fails) and §13 (host-only principle + the precedence chain). Then the code: `src/repo-config.ts` (`resolveRepoConfig`, `resolveRepoConfigFromLoaded` — the resolution core; the allow/reject split that does NOT apply to the override), `src/config.ts` (`Config`, `mergeConfig`, `defaultConfigPath`/`configDir`, `loadConfig`), `src/repo-mirror.ts` (`encodeRepoKey` — the hub key), `src/do.ts` (~L1607, the `git remote get-url <arbiter>` pattern), and the `resolveRepoConfig` call sites (`src/cli.ts`, `src/scan.ts`).
>
> Build: (1) an INJECTABLE-path reader for `<configDir>/config.override.json` returning the `{"*"?: PartialConfig, [hubKey]: PartialConfig}` map (missing file ⇒ empty; invalid JSON ⇒ loud error naming the file; tests point it at a scratch path, never the real `~`); (2) thread an OPTIONAL resolved arbiter URL into `resolveRepoConfigFromLoaded` so the hub key can be computed with `encodeRepoKey`, and wire ALL THREE callers to supply it: working-tree `resolveRepoConfig` via `resolveArbiterUrlFromCheckout(repoPath, defaultArbiter, env)` (`do.ts`), no-checkout `resolveRepoConfigFromMirror` via the mirror's `origin` URL (`readOriginUrl` in `registry.ts` — currently file-private; export it instead of duplicating the `git remote get-url origin` call), and `do --remote`'s `resolveRemoteRepoConfig` via the URL it already holds; (3) in `resolveRepoConfigFromLoaded`, insert `...override["*"]` then `...override[hubKey]` as spread layers BETWEEN the committed repo config and env — sparse shallow merge, never mutating `global`; (4) the override may set ANY key (host-only included) — do NOT run it through `REPO_ALLOWED_KEYS`/`REPO_REJECTED_KEYS`; (5) graceful degrade when the URL is unresolvable (skip the hub-key lookup, keep `"*"`), never erroring. READ ALSO: `src/repo-mirror.ts` (`resolveRepoConfigFromMirror`, `encodeRepoKey`), `src/scan.ts` (the mirror resolution call sites), `src/registry.ts` (`readOriginUrl` — file-private, export it). Do NOT add a CI/runner config split, a profile axis, or env vars for the override file. Do NOT change global-vs-per-repo precedence. Match house style; TDD with vitest (inject the override path / map / env / global so tests need not touch real `process.env` or `~`). "Done" = acceptance criteria met and the gate is green (`pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check`).
