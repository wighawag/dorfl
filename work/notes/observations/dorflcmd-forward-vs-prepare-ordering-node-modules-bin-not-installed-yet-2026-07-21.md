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
  clone until `pnpm install` (the repo's `prepare` step) has run.
- But `prepare` is run BY dorfl (`ensurePrepared` inside `do`/`run`/the fresh-worktree
  gate). And the forward happens at STARTUP, before any command (hence before prepare).
- So: the bootstrap forwards → target absent → (task says) FAIL LOUD → the very command
  that would install the deps never runs. Circular. A fresh checkout would be bricked.

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
  pre-install; an `npx`/`mise` cache miss is NOT this — those self-fetch): DEGRADE to the
  bootstrap/global dorfl (so the bootstrap can run `prepare`, after which subsequent
  `dorfl` invocations forward to the now-present pin). NOT an error.
- **Target PRESENT but exec FAILED** (spawn error, non-zero from a real binary): fail loud
  (the pin is genuinely broken).

Consequence to accept + document: the command that runs `prepare` (the first invocation
on a fresh checkout) uses the BOOTSTRAP dorfl, not the pinned one — a one-invocation skew
that is unavoidable for the `node_modules/.bin` form (you cannot use a dorfl that isn't
installed to install itself). The `npx dorfl@<version>` / vendored-`./bin/dorfl` forms do
NOT have this dependency (npx self-fetches; a vendored binary is committed), so a repo that
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
