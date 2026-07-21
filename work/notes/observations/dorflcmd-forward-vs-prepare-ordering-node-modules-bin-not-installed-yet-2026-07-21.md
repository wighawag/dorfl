---
title: dorflCmd forward must degrade (not fail-loud) when the target is not installed yet — the node_modules/.bin/dorfl case depends on prepare, which dorfl itself runs (circular)
type: observation
status: spotted
spotted: 2026-07-21
needsAnswers: true
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

## The recursion-safety fact that decides it (traced)

The question "if we fail on an absent `dorflCmd`, won't the fresh gate worktree (no
`node_modules`) also fail?" resolves to NO, because **the forward is a once-at-startup,
checkout-root-only decision — it is NOT recursive:**

- The gate worktree is created by the ALREADY-RUNNING dorfl (`git worktree add` in
  `integration-core.ts`), and its `prepare`/`verify` run via `spawn('bash', ['-c', cmd],
  {cwd: worktreeDir})` (`prepare.ts`/`verify.ts`) — they execute the repo's `pnpm install` /
  build DIRECTLY as bash, NEVER by launching a new `dorfl`.
- So a fresh worktree's empty `node_modules` NEVER triggers a second forward. `dorflCmd`
  is consulted only at the top-level entry, once, in the checkout root.

The worktree needs `prepare` so `verify` (build/test) has the repo's deps IN THAT
WORKTREE — nothing to do with installing the dorfl CLI (the outer dorfl is already running).

## The decision (option B — FAIL LOUD on declared-but-absent)

Maintainer decision 2026-07-21: a DECLARED `dorflCmd` whose target does not resolve FAILS
LOUD, it does NOT silently degrade. Rationale:

- The repo's dependency install is a hard PRECONDITION of invoking dorfl (CI's
  `install-ci` project-setup hook runs it before the dorfl steps; a user runs `pnpm
  install`). If `node_modules/.bin/dorfl` is absent at the top-level entry, the install
  almost certainly did not run — a MISCONFIGURATION.
- Silently degrading to the global would run the WRONG version, the exact drift the pin
  exists to prevent — worse than a clear error.
- Onboarding is unaffected: `setup`/`install-ci` run before `dorflCmd` is declared, so they
  hit the no-`dorflCmd`-run-self branch, never the declared-but-absent one.
- The rare legitimate pre-install read-only invocation (a pinned repo running `dorfl
  status` before installing) uses the `--no-forward` / `DORFL_NO_FORWARD=1` bypass.

So BOTH "declared-but-absent" and "present-but-exec-failed" fail loud with a clear message
(value + `dorfl.json` path + the fix + the bypass). `npx dorfl@<version>` / a vendored
`./bin/dorfl` avoid the absent case entirely (self-fetching / committed).

## Fix applied

- `dorfl-bootstrap-self-forward` acceptance criteria + prompt: declared-but-absent FAILS
  LOUD (not degrade); add the once-at-startup / non-recursive framing + a test proving the
  gate-worktree `prepare` runs via bash (no new `dorfl`, so an un-installed worktree does
  not re-trigger the forward).
- Spec Solution §2: record fail-loud-on-absent + the recursion-safety rationale.

## Refs

- `packages/dorfl/src/install-ci-core.ts` — PREFER-LOCAL RESOLVER shim (`-x` check; the CI
  shim degrades, but dorfl-the-bootstrap fails loud because — unlike a dumb bash shim — it
  can distinguish no-`dorflCmd`-declared (onboarding) from declared-but-absent (misconfig)).
- `packages/dorfl/src/prepare.ts` / `verify.ts` — `runPrepare`/`runVerify` execute the
  repo command via `spawn('bash', ['-c', cmd], {cwd})`, NEVER a recursive `dorfl` (the
  fact that makes fail-loud safe).
- `packages/dorfl/src/integration-core.ts` — the throwaway gate worktree + `ensurePrepared({cwd: worktreeDir})`.
- Task `work/tasks/backlog/dorfl-bootstrap-self-forward.md`; spec
  `work/specs/tasked/dorfl-self-version-pinning-and-bootstrap-forward.md`.
