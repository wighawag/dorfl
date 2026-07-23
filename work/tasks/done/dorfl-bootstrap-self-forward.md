---
title: 'Bare `dorfl` self-forwards to the repo-declared `dorflCmd` (announced, opt-outable)'
slug: dorfl-bootstrap-self-forward
spec: dorfl-self-version-pinning-and-bootstrap-forward
blockedBy: [dorfl-cmd-config-field]
covers: [1, 4, 5]
---

## What to build

Make the globally-installed `dorfl` a thin BOOTSTRAP that self-forwards to a
repo-declared `dorflCmd`. On startup, BEFORE any command dispatch, the running `dorfl`
reads the nearest repo `dorfl.json`; if it declares `dorflCmd` AND that command is not
the process already running, it `exec`s the command with the ORIGINAL argv + env
inherited, after a one-line **stderr** notice. The forwarded process's exit code is the
bootstrap's exit code (transparent passthrough).

Guards, all end-to-end in this one vertical task:

- **Onboarding-safe:** NO `dorflCmd` declared ⇒ the bootstrap runs ITSELF (so `setup` /
  `install-ci` in a not-yet-pinned repo just work — never chicken-and-egg).
- **Loop-safe:** the forwarded dorfl reads the SAME `dorfl.json` and must NOT forward
  again forever. Detect "this command IS me / already forwarded" and run in-process
  rather than re-exec (e.g. an env marker set on the child, and/or a same-target check).
- **The forward decision fires ONCE, at bare-`dorfl` startup, in the CHECKOUT ROOT — it is
  NOT recursive.** This is the load-bearing fact that makes fail-loud safe. The gate
  worktree that runs `prepare`/`verify` does NOT launch a new `dorfl`: the already-running
  dorfl creates the worktree and runs the repo's `prepare`/`verify` commands via
  `spawn('bash', ['-c', cmd], {cwd: worktreeDir})` (see `prepare.ts`/`verify.ts`). So a
  fresh worktree's empty `node_modules` NEVER triggers a second forward. `dorflCmd` is
  consulted only at the top-level entry, once.
- **Declared-but-ABSENT `dorflCmd` FAILS LOUD** (decision 2026-07-21, option B). If
  `dorflCmd` is declared but its target does not resolve (e.g. `node_modules/.bin/dorfl`
  before the repo's deps are installed), that is almost always a MISCONFIGURATION (the
  repo's install step did not run) — silently degrading to the global would run the WRONG
  version and defeat the whole point of pinning. Emit a CLEAR error naming the `dorflCmd`
  value + the `dorfl.json` path + the fix (run the dependency install first, e.g. `pnpm
  install` / the CI project-setup hook) + the `--no-forward` / `DORFL_NO_FORWARD=1` bypass.
  Onboarding is NOT affected: `setup`/`install-ci` run in a repo that has NOT declared
  `dorflCmd` yet, so they hit the no-`dorflCmd`-run-self branch, never this one. The rare
  legitimate case (a pinned repo running a read-only `dorfl status` before installing) uses
  the `--no-forward` bypass.
- **PRESENT but exec FAILS** (a real binary that spawn-errors / exits non-zero for a
  non-forwarding reason): also a CLEAR error (the pin is genuinely broken), same shape as
  the absent case.
- **Announced:** one line to **stderr** (never stdout — must not corrupt `--json`),
  e.g. `dorfl: forwarding to `<cmd>` (from <path>/dorfl.json)`.
- **Opt-out (both forms):** `DORFL_NO_FORWARD=1` OR a CLI flag `--no-forward` DISABLES
  forwarding (run the bootstrap/global as-is) AND suppresses the notice. Both are honoured
  BEFORE dispatch so a user can always reach the bootstrap dorfl directly.

## Acceptance criteria

- [ ] With a `dorflCmd` set to a different command, bare `dorfl <args>` execs that command
      with argv + env passed through and returns its exit code.
- [ ] With NO `dorflCmd`, the bootstrap runs itself unchanged (byte-for-byte today's
      behaviour) — a test proves no forward path is taken.
- [ ] Re-entrancy: the forwarded process does not forward again (no infinite loop) — a
      test drives a `dorflCmd` that points back at dorfl and asserts a single hop.
- [ ] A declared `dorflCmd` whose target does NOT resolve (absent — e.g.
      `node_modules/.bin/dorfl` before the repo's dependency install) FAILS LOUD: a clear,
      actionable error naming the `dorflCmd` value + `dorfl.json` path + the fix (run the
      dependency install first) + the `--no-forward`/`DORFL_NO_FORWARD` bypass, and a
      non-zero exit — NOT a silent degrade to the global (which would run the wrong
      version). A test drives an absent `dorflCmd` and asserts the loud error.
- [ ] A `dorflCmd` that is PRESENT but exec-fails (a real binary that spawn-errors / exits
      non-zero) yields the same clear, actionable error. Tests cover both absent and
      present-but-failed.
- [ ] The forward is NOT recursive: a test proves the gate-worktree `prepare` path runs
      the repo command via bash (not a new `dorfl`), so an un-installed worktree does not
      re-trigger the forward (the forward hook runs once, at entry).
- [ ] The notice goes to STDERR only; a `--json`-producing command's STDOUT is uncorrupted
      when a forward happens (assert stdout is exactly the forwarded stdout).
- [ ] `DORFL_NO_FORWARD=1` and `--no-forward` each disable forwarding + suppress the
      notice; both are recognised before command dispatch (a test for each).
- [ ] Tests drive the exec via an injectable seam (a stubbed spawn/exec) — no real
      re-exec of a second dorfl, no network. Fixtures isolate `dorfl.json` in a scratch
      dir; no shared location written.

## Blocked by

- `dorfl-cmd-config-field` — the bootstrap reads the `dorflCmd` field this adds.

## Prompt

> Turn the global `dorfl` into a thin bootstrap that self-forwards to the repo-declared
> `dorflCmd` (added by the blocking task `dorfl-cmd-config-field`). Read the spec
> `dorfl-self-version-pinning-and-bootstrap-forward` Solution §2 and §4 — this task
> covers stories 1, 4, 5.
>
> The hook is the CLI entry, BEFORE command dispatch: in `cli.ts` the program builds its
> commander tree and calls `program.parseAsync(argv)` near the end — the forward decision
> must happen before that (or before any command action runs), reading the nearest repo
> `dorfl.json` via the existing repo-config resolution (`resolveRepoConfigPath` /
> `REPO_CONFIG_FILENAME` in `repo-config.ts`) and the `dorflCmd` field.
>
> Design the forward as an INJECTABLE seam (a function that takes the resolved `dorflCmd`
> + argv + env + an exec/spawn function) so it is unit-testable WITHOUT re-execing a real
> second dorfl or hitting the network — mirror how the codebase already injects git/agent
> seams in tests. Cover, end to end: forward-happens, no-`dorflCmd`-runs-self,
> re-entrancy-single-hop (set an env marker on the child so the forwarded dorfl reading the
> same `dorfl.json` runs in-process instead of forwarding again), ABSENT-target-FAILS-LOUD
> (a declared `dorflCmd` whose target does not resolve — the `node_modules/.bin/dorfl`-
> before-install case — errors clearly, NOT a silent degrade), PRESENT-but-exec-fails-
> fails-loud, stderr-only-notice (stdout uncorrupted for `--json`), and BOTH opt-outs
> (`DORFL_NO_FORWARD=1` env + `--no-forward` flag) disabling + silencing the forward.
>
> Absent-handling is FAIL LOUD (decision 2026-07-21, option B), and it is SAFE because the
> forward is a ONCE-AT-STARTUP, checkout-root-only decision — NOT recursive. Trace it to be
> sure: the gate worktree that needs `prepare` is created + prepared by the ALREADY-RUNNING
> dorfl, which runs the repo's `prepare`/`verify` via `spawn('bash', ['-c', cmd], {cwd:
> worktreeDir})` (`prepare.ts`/`verify.ts`) — it NEVER launches a new `dorfl`, so a fresh
> worktree's empty `node_modules` never re-triggers the forward. Therefore a
> declared-but-absent `dorflCmd` at the top level is almost always a misconfiguration (the
> repo's install did not run); fail loud with the fix (run the dependency install) + the
> `--no-forward`/`DORFL_NO_FORWARD` bypass, rather than silently running the wrong version.
> The pin is populated by the REPO's own install (CI `install-ci` project-setup hook, or
> the user's `pnpm install`) — dorfl does NOT install its own pin (`prepare` is
> worktree-gate env-prep, not a CLI install). `setup`/`install-ci` are unaffected (they run
> before `dorflCmd` is declared → the run-self branch). See the observation
> `dorflcmd-forward-vs-prepare-ordering-node-modules-bin-not-installed-yet` for the full
> trace.
>
> There is NO trust gate — honour `dorflCmd` verbatim (same trust as the committed
> `verify` command; see the spec §3). Exec transparently: inherit argv + env, propagate
> the child's exit code. Run `pnpm format && pnpm -r build && pnpm -r test` and add a
> changeset before finishing.
