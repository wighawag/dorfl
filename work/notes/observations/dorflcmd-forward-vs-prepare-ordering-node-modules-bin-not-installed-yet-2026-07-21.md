---
title: dorflCmd forward must degrade (not fail-loud) when the target is not installed yet — the node_modules/.bin/dorfl case depends on prepare, which dorfl itself runs (circular)
type: observation
status: spotted
spotted: 2026-07-21
---

## What was seen

Reviewing the tasking of `dorfl-self-version-pinning-and-bootstrap-forward`, the maintainer
asked: does the design consider that `prepare` (`pnpm install`) must run before a
`dorflCmd` of `node_modules/.bin/dorfl` even EXISTS? It does not — and the emitted
`dorfl-bootstrap-self-forward` task got the error semantics WRONG for that case.

## The gap

The forward task says: *"a `dorflCmd` that cannot be run (missing binary) is a CLEAR
error (fail loud), never a silent fall-through to the global."* That is correct for a
genuinely-broken command, but WRONG for the JS devDep form:

- `dorflCmd: "node_modules/.bin/dorfl"` does NOT exist on a fresh checkout / fresh CI
  clone until the repo's dependencies are installed.
- The forward happens at STARTUP, before any command runs. So a fresh checkout, first
  `dorfl` invocation, would forward to an absent path → (task says) FAIL LOUD → bricked.

## CORRECTION (what actually populates the pin — NOT dorfl's `prepare`)

An earlier draft of this note claimed "degrade to the bootstrap, which then runs `prepare`
to install the pin." **That mechanism is WRONG** — traced in the code:

- dorfl's `prepare` (`ensurePrepared`) is NOT a general `pnpm install` of the checkout
  root. It runs DEEP inside a command (`performIntegration` / the fresh-worktree gate in
  `integration-core.ts`), only for BUILD/integrate paths (`do`/`complete`/`advance`/`run`)
  — a read-only `status`/`scan`/`claim` runs NO prepare at all. And under the
  fresh-worktree gate it installs into a THROWAWAY temp worktree, NOT
  `$GITHUB_WORKSPACE/node_modules`. So "the bootstrap runs prepare" does NOT reliably
  populate the `node_modules/.bin/dorfl` the forward looks for.
- What ACTUALLY populates it: the repo's OWN dependency install — in CI, the `install-ci`
  **project-setup hook** (`install-ci-project-setup-hook`, spliced into `dorfl-setup`
  BEFORE dorfl-install) or the project's install step; locally, the user's `pnpm install`.
  The existing shim comment says exactly this: `node_modules/.bin/dorfl` is *"populated by
  the project-setup hook's `pnpm install`"* and *"the shim runs AFTER the install."*

So the degrade-to-bootstrap rule is STILL correct, but for the RIGHT reason: it is NOT
dorfl's job to bootstrap its own pin into existence. The bootstrap must simply be able to
RUN on a fresh checkout — (a) for commands that install nothing, and (b) in the window
BEFORE the repo's own install step populates the pin. The repo's environment (CI hook /
user `pnpm install` / a committed vendored binary / npx self-fetch) owns making
`dorflCmd` resolvable; dorfl just forwards-if-present, degrades-if-absent.

## The existing precedent already solves it (the review should have caught this — lens 1)

The `install-ci` CI shim (`install-ci-core.ts`, PREFER-LOCAL RESOLVER) already handles
exactly this with an EXISTENCE check, not fail-loud:

```
local_bin="${GITHUB_WORKSPACE:-$PWD}/node_modules/.bin/dorfl"
if [ -x "$local_bin" ]; then exec "$local_bin" "$@"; fi
exec "$(cat global-path)" "$@"   # else fall back to the global bootstrap
```

i.e. **"if the pinned dorfl is not installed yet, use the bootstrap"** — a graceful
degrade, NOT an error. The `dorfl-setup` action also orders a project `pnpm install`
BEFORE the resolver shim goes on PATH (comment: "the shim runs AFTER the install"), so the
window is small in CI; the `-x` check covers it regardless.

## The distinction the bootstrap forward MUST make

Two different "cannot run" cases, opposite handling:

- **Target ABSENT** (the path/command does not resolve yet — `node_modules/.bin/dorfl`
  before the repo's OWN install step; an `npx`/`mise` cache miss is NOT this — those
  self-fetch): DEGRADE to the bootstrap/global dorfl so the command still RUNS. It is NOT
  dorfl's job to install the pin (see the CORRECTION above — the repo's install
  step/hook/user does that); the degrade just avoids bricking the window before the pin
  exists AND covers commands that install nothing. NOT an error.
- **Target PRESENT but exec FAILED** (spawn error, non-zero from a real binary): fail loud
  (the pin is genuinely broken).

Consequence to accept + document: any `dorfl` invocation BEFORE the repo's install step has
populated `node_modules/.bin/dorfl` uses the BOOTSTRAP dorfl, not the pin — a window that
the repo closes by installing deps early (in CI, the `install-ci` project-setup hook runs
the install BEFORE dorfl steps; the `-x`/absent check covers any residual window). The
`npx dorfl@<version>` / vendored-`./bin/dorfl` forms do NOT have this window (npx
self-fetches; a vendored binary is committed), so a repo that
wants the pin honoured even for the prepare-running invocation should prefer those.

## Fix applied

- `dorfl-bootstrap-self-forward` acceptance criteria + prompt: replace "missing binary =
  fail loud" with the ABSENT-degrades / PRESENT-but-failed-fails-loud distinction, mirror
  the shim's `-x` existence check, and add a test for "dorflCmd target absent ⇒ run
  bootstrap (prepare can still run), not an error."
- Spec Solution §2/§4: record the degrade-when-absent rule + the one-invocation
  bootstrap-runs-prepare skew for the `node_modules/.bin` form.

## Refs

- `packages/dorfl/src/install-ci-core.ts` — PREFER-LOCAL RESOLVER shim (`-x` check).
- `packages/dorfl/src/do.ts` — `prepare` runs via dorfl (`ensurePrepared`/strategy.prepare).
- Task `work/tasks/backlog/dorfl-bootstrap-self-forward.md`; spec
  `work/specs/tasked/dorfl-self-version-pinning-and-bootstrap-forward.md`.
