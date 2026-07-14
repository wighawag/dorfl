---
title: A per-machine override layer (global config.override.json) above committed repo config — sparse, hub-keyed, with a "*" global-default bucket
status: accepted
created: 2026-06-20
decided: 2026-06-20
supersedes:
superseded_by:
---

# ADR: Per-machine config override layer (`config.override.json`)

## Context

A user wants the SAME repo to resolve config DIFFERENTLY depending on the
operator context driving it — the motivating case is "my laptop does one thing,
CI does another" (e.g. `integration: merge` when I am watching interactively vs
`propose` in unattended CI; autonomy gates on in CI but off on the laptop where I
drive explicitly). Underneath, the real axis is **attended/interactive vs
unattended/autonomous**; "laptop vs CI" is just the usual instance of it.

CI already has a clean, high-precedence per-machine lever: the workflow's
`DORFL_*` env block (the env layer sits ABOVE the committed per-repo file —
see the precedence chain below). The LAPTOP does not have an equivalent that is
both (a) high-precedence (able to override a value the repo committed) and (b)
stable across invocations. Its only per-machine sources are flag (per-invocation,
"depends where it's invoked"), env (awkward to set reliably from an arbitrary
shell/cwd), and the global config — and the global config is the WEAKEST
deliberate layer, BELOW the committed repo file, so it cannot override what the
repo committed.

The existing precedence chain (recorded in `execution-substrate-decisions.md` §13
and stated identically in `config.ts`/`repo-config.ts`/`env-config.ts`) is:

```
flag > ENV (DORFL_*) > per-repo committed (dorfl.json) > global > built-in default
```

### Why the existing ordering is RIGHT and is NOT reversed by this ADR

The layers are ordered by **specificity / agreement scope, not by authority**.
Global is "my defaults on this machine, across all repos" — the least specific, so
the weakest deliberate layer. The committed per-repo file is "what all
collaborators + agents AGREED for THIS repo"; it is shared, it TRAVELS with the
repo, and it is what lets repo A be `merge` while repo B is `propose` in the same
multi-repo run. Reversing global > per-repo would let one person's global config
silently override a repo's collaboratively-agreed, committed policy and would kill
the multi-repo story. So per-repo committed stays ABOVE global. The genuine gap is
NOT the ordering; it is that the laptop lacks a per-machine layer ABOVE the
committed repo file (the slot env occupies for CI).

### Why a gitignored `.dorfl.local.json` was REJECTED

The obvious `.env.local` analogue dies on the runner's execution substrate
(`execution-substrate-decisions.md` §2). The runner NEVER operates on the user's
editable checkout: it materialises a FRESH `git worktree` per job at
`~/.dorfl/work/<work-id>/`, checked out from the bare HUB MIRROR, itself
fetched from the arbiter. A gitignored file lives only in the user's working tree;
it is by definition never committed, so it never reaches the arbiter, never reaches
the hub mirror, and never appears in the job worktree. The runner would never see
it. It would "work" only for an interactive `do` from the user's checkout and
silently vanish for every actual runner job — config that works in the demo and is
absent in production. Rejected.

## Decision

Add ONE new **per-machine override layer**, sourced from the global config
directory, that sits ABOVE the committed per-repo file (and global), but BELOW env
and flags.

### 1. New precedence chain

```
flag > ENV (DORFL_*) > override:per-repo > override:global("*") > per-repo committed > global > built-in default
```

- **Below flag and below env** — a one-off `--merge` and CI's env layer must still
  win, otherwise a sticky machine override would block a deliberate per-invocation
  intent or override how CI speaks. On the laptop, where env is typically unset,
  the override is effectively the top sticky layer (the intended effect).
- **Above the committed per-repo file** — this is the entire point, and the
  deliberate, recorded exception to "per-repo beats global." A PER-MACHINE source
  is allowed to override committed repo policy; env already does, and this gives
  the laptop a stable, file-based equivalent of env (the same host-only principle:
  per-machine sources — flag, env, global file, and now this override file — may
  override the committed repo file; the committed file may not carry host-only
  policy). It is conceptually env-the-laptop-can-actually-set-from-anywhere.

### 2. One file, hub-keyed, with a `"*"` global-default bucket

A single file `~/.config/dorfl/config.override.json` (i.e.
`<configDir>/config.override.json`, the same directory as the global `config.json`).
Shape:

```json
{
  "*": { "autoBuild": false },
  "github-com/wighawag/dorfl": { "integration": "merge" }
}
```

- **The repo key is the HUB KEY**, not a filesystem path —
  `encodeRepoKey(arbiterUrl)` (`repo-mirror.ts`), e.g.
  `github-com/wighawag/dorfl`. This is the single load-bearing choice that
  makes the override survive the mirror model where `.local` failed: the hub key
  resolves IDENTICALLY from the user's interactive checkout AND from a throwaway
  job worktree, because it is derived from the arbiter URL, not from where the
  bytes happen to live on disk.
- **`"*"` is the global-default override bucket** — "on this machine, for ALL
  repos, force these fields." A specific hub-key entry beats `"*"`, mirroring how
  the committed per-repo file beats global one level down. So the two override
  scopes are ONE per-machine layer with two specificities (this-repo > all-repos),
  resolved most-specific-first — the same shape as the (committed-repo > global)
  pair it sits above. That symmetry is what makes it sensical rather than
  bolted-on.

### 3. Sparse / shallow merge — an override only touches the fields it names

An override object overrides ONLY the keys it lists; every unlisted key continues
to resolve through the rest of the chain. This is not a new merge rule — it is
exactly the existing per-key shallow merge (`mergeConfig({...global, ...repo,
...env, ...flags})`); the override simply inserts two more spread layers in the
right slots. The effective per-repo merge becomes (conceptually):

```
mergeConfig({ ...global, ...committedRepo, ...override["*"], ...override[hubKey], ...env, ...flags })
```

### 4. May set ANY key (host-only included)

The override file is a PER-MACHINE source in the same class as env, a flag, and
the global config file, so the sharpened host-only principle
(`execution-substrate-decisions.md` §13) is satisfied: it may set ANY `Config`
key, host-only included (`piBin`, `agentCmd`, …). It is therefore NOT subject to
the `REPO_ALLOWED_KEYS`/`REPO_REJECTED_KEYS` split — that split governs ONLY the
committed repo file. This makes the override strictly more capable than the global
config for a single repo (per-repo host-only overrides become possible), which is
useful and consistent with how env already behaves.

### 5. Not a "CI vs runner" config split

This deliberately does NOT introduce a `ci: {}` / `runner: {}` namespace, and does
NOT make CI a second policy surface. The ADR `ci-config-policy-and-gate-family`
decided "CI is not a special policy surface": CI is the same engine tuned by the
same `Config` chain, with the workflow's `DORFL_*` env as its per-machine
override. This ADR keeps that intact and symmetrical: ONE `Config` schema, ONE
resolution chain; CI's per-machine lever is env, the laptop's is
`config.override.json`. The operator-context difference ("attended vs unattended")
is expressed by WHICH machine carries WHICH override, not by a parallel config
type. A profile/role axis (named `interactive`/`unattended` blocks) was considered
and deferred: there are not yet enough concrete cases to design a good profile
schema, and `ci-config-policy-and-gate-family` warns against speculative second
policy surfaces. The override file delivers ~90% of the value at near-zero
conceptual cost; a profile axis can layer on later if a real need appears.

## Considered options

- **Reverse global > per-repo.** Rejected: breaks the committed-repo-policy
  promise and the multi-repo story (see Context).
- **Gitignored `.dorfl.local.json`.** Rejected: invisible to the runner's
  hub-mirror + job-worktree substrate (see Context).
- **A `ci: {}` / `runner: {}` config split.** Rejected: re-litigates
  `ci-config-policy-and-gate-family` without a motivating case (see §5).
- **A `--profile interactive|unattended` axis selecting named config blocks.**
  Deferred, not rejected (see §5): more expressive but premature; the override
  file is the minimal ADR-compatible mechanism for the concrete pain today.

## Consequences

- The laptop gains a stable, high-precedence, per-machine override symmetric to
  CI's env, fixing "I can't make this checkout override what the repo committed
  without an env var whose setting depends on where I invoke from."
- The precedence chain grows two slots (override:per-repo, override:global) between
  env and the committed per-repo file; the global config's position and the
  committed-repo-beats-global rule are UNCHANGED.
- Implementation threads the SAME 5 points the gate family uses, but at the
  RESOLUTION site rather than per key: read `<configDir>/config.override.json`,
  derive the repo's hub key via `encodeRepoKey`, and insert
  `override["*"]` then `override[hubKey]` as spread layers between the committed
  repo file and env in `resolveRepoConfig`/`resolveRepoConfigFromLoaded`. Invalid
  JSON fails loudly (like the other config readers); a missing file is a no-op
  (resolves to exactly today's behaviour).
- Cross-refs: `execution-substrate-decisions.md` (§2 substrate that killed
  `.local`, §13 host-only principle + the precedence chain),
  `ci-config-policy-and-gate-family.md` (CI is not a special policy surface — kept
  intact), `repo-mirror.ts` (`encodeRepoKey` — the hub key),
  `repo-config.ts`/`config.ts`/`env-config.ts` (the resolution plumbing the new
  layer slots into).
