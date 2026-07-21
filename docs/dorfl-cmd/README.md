# Pinning the dorfl version: `dorflCmd` + the bootstrap self-forward

A repo can declare, in its `dorfl.json`, the exact dorfl it is built / advanced /
intaked with, so builds are **reproducible** instead of floating with whatever
`dorfl` a machine happens to have globally installed. This page is the reference for
the one config field that does it — **`dorflCmd`** — and the upgrade ritual that
keeps the pinned CLI, the `work/protocol/` docs, and the CI workflow aligned.

> Spec: `dorfl-self-version-pinning-and-bootstrap-forward`. ADR:
> `docs/adr/dorfl-cmd-repo-settable-exception-to-host-only.md`.

## The mental model

**dorfl is a TOOL, like `prettier` or `tsc`.** You do not run the globally-installed
`prettier` against a repo pinned to a different one; you run the repo's pinned
`prettier`. dorfl works the same way, with one twist that keeps the workflow
project-independent:

- **The globally-installed `dorfl` is a thin BOOTSTRAP.** Agents (and humans) are
  taught to invoke bare **`dorfl`** — never `pnpm dorfl` / `npx dorfl` — so the
  taught commands do not leak a JS-ecosystem assumption into a Rust / Go / Python
  repo. Bare `dorfl` stays the one project-independent command.
- **The repo declares which dorfl bare `dorfl` runs, via `dorflCmd`** in
  `dorfl.json`.
- **Bare `dorfl` self-forwards to it.** On startup, before doing any work, the
  running `dorfl` reads the nearest repo `dorfl.json`; if it declares `dorflCmd`
  (and this process is not already the forwarded one), it `exec`s that command with
  your original arguments + environment, after a one-line notice on **stderr**, and
  exits with the child's exit code. You keep typing bare `dorfl`; the repo decides
  the version.

So an agent's muscle memory (`dorfl do`, `dorfl advance`, `dorfl intake`) never
changes, but on a pinned repo those commands run the pinned dorfl, on every laptop
and in CI alike.

## Declaring `dorflCmd` (per ecosystem)

`dorflCmd` is an **explicit command string**, honoured verbatim — the command bare
`dorfl` forwards to. dorfl does **not** resolve, download, or cache a version: the
command names whatever the repo's environment already provides. Pin the way your
ecosystem already pins tools:

| Ecosystem                    | `dorfl.json`                                     | Notes                                                                                     |
| ---------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| **JS repo (devDep)**         | `"dorflCmd": "node_modules/.bin/dorfl"`          | Add `dorfl` to `devDependencies` at the pinned version; the command runs the installed bin. |
| **Any repo with npx**        | `"dorflCmd": "npx dorfl@0.7.0"`                   | `npx` self-fetches the exact version — no devDep, no pre-install step needed.              |
| **Vendored binary**          | `"dorflCmd": "./bin/dorfl"`                        | A committed / build-produced binary; nothing to resolve.                                   |
| **Toolchain manager**        | `"dorflCmd": "mise exec dorfl@0.7.0 --"`          | `mise` / `asdf` / any shim your environment resolves; the trailing `--` passes argv through. |

For a **JS repo** the pinned bin usually lives at `node_modules/.bin/dorfl`, which
requires the repo's dependency install to have run first (see the fail-loud note
below). `npx dorfl@<version>` and a vendored `./bin/dorfl` avoid that: `npx`
self-fetches and the vendored binary is committed, so neither depends on a prior
install.

> **A version is written by you, not resolved by dorfl.** There is no
> `dorflVersion` field and no version shorthand — you express a version by writing
> `npx dorfl@<version>` (or a `mise`/`asdf` pin) yourself. See
> [Non-goals](#non-goals) below.

## The announce, and how to opt out

The forward prints ONE line to **stderr** (never stdout — it must not corrupt
`--json` output):

```
dorfl: forwarding to `npx dorfl@0.7.0` (from ./dorfl.json)
```

To reach the bootstrap dorfl directly (run whatever `dorfl` is on `PATH`, ignoring
the pin), use EITHER opt-out — both DISABLE the forward AND silence the notice, and
both are honoured before any command dispatch:

- the CLI flag **`--no-forward`**, or
- the env var **`DORFL_NO_FORWARD=1`**.

> **`--no-forward` runs whatever `dorfl` is on `PATH`, NOT the pinned version.** It
> is an escape hatch for reaching the bootstrap dorfl (e.g. to debug the forward
> itself), not a way to run the repo's intended version.

### A broken pin fails loud

A `dorflCmd` that is DECLARED but whose target does not resolve (e.g.
`node_modules/.bin/dorfl` before `pnpm install` has run), or a present binary that
fails to spawn, is a **clear error** — not a silent degrade to the global (which
would run the WRONG version and defeat the pin). The error names the `dorflCmd`
value, the `dorfl.json` path, the fix (run the repo's dependency install first),
and the `--no-forward` / `DORFL_NO_FORWARD` bypass. When **no** `dorflCmd` is
declared, the bootstrap runs itself — so onboarding a not-yet-pinned repo is never
chicken-and-egg.

## The upgrade ritual

Three things travel together and must stay aligned when you move a repo to a new
dorfl: the pinned **CLI** (`dorflCmd`), the vendored `work/protocol/` **docs**, and
(only sometimes) the CI **workflow YAML**. Bump them in this order:

1. **Bump `dorflCmd`** to the new version (edit `dorfl.json` — e.g.
   `npx dorfl@0.8.0`, or bump the `dorfl` devDependency and re-install). This is a
   deliberate, reviewable, human-made change, like any pinned-version bump; nothing
   auto-advances it.
2. **Run `dorfl sync`** to re-sync `work/protocol/` to the new version's canonical
   contract docs (and bump `work/protocol/VERSION`). This keeps the DOCS in the repo
   matching the EXECUTABLE you just pinned.
3. **Re-run `install-ci` ONLY if the workflow TEMPLATES changed** — not for a
   routine version bump. A plain version bump reuses the existing workflow; you only
   re-copy the CI template when the template's SHAPE changed between versions (see
   [`docs/ci/README.md`](../ci/README.md)).

> **`dorfl sync` (docs) vs `dorflCmd` (executable) — two different things.**
> `dorfl sync` pins the `work/protocol/` DOCS to the installed dorfl; `dorflCmd`
> pins the dorfl EXECUTABLE that bare `dorfl` runs. The upgrade ritual is exactly
> the procedure that keeps them from drifting apart.

## Non-goals

The mechanism is deliberately minimal. Do NOT expect a version manager:

- **No version resolution / download / cache.** There is no `dorflVersion` field, no
  `~/.dorfl/versions/<v>/` store, no integrity/offline handling. `dorflCmd` is a
  command the repo's environment already resolves; a user who wants a pinned version
  writes `npx dorfl@<version>` (or a `mise`/`asdf` pin) themselves. dorfl never
  re-implements a package manager.
- **No trust gate.** `dorflCmd` is honoured verbatim from the committed
  `dorfl.json`, at the SAME trust level dorfl already grants the committed `verify`
  command (itself an arbitrary shell command run from `dorfl.json`). Running `dorfl`
  in a repo already means trusting its `dorfl.json`; `dorflCmd` introduces no new
  trust class. There is no `--trust-dorfl-cmd`, no untrusted-origin special-casing.
- **It does not pin the AGENT HARNESS** (`pi`). `dorflCmd` pins dorfl itself; the
  harness version is a separate axis (`agentCmd` / `piBin`).

## Relationship to the CI shim

`install-ci`'s `dorfl-setup` step historically installs `dorfl` globally
(`npm install -g dorfl`) and prefers a project-local `node_modules/.bin/dorfl` via a
`$PATH` shim. Once bare `dorfl` self-forwards from `dorfl.json`, CI's global `dorfl`
forwards to the repo's declared `dorflCmd` by the SAME generic mechanism the laptop
uses — one code path, JS and non-JS alike — so the bespoke shim is no longer the
only pinning path. See [`docs/ci/README.md`](../ci/README.md).
