---
title: Bare `dorfl` self-forwards to the repo-declared `dorflCmd` (announced, opt-outable)
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
- **Absent-target DEGRADES (not an error) — the `prepare` ordering.** A `dorflCmd`
  pointing at a path that does NOT EXIST YET (the JS `node_modules/.bin/dorfl` form before
  the repo's `prepare`/`pnpm install` has run) DEGRADES to the bootstrap/global dorfl —
  NOT a fail-loud error. This is REQUIRED because `prepare` is run BY dorfl (via
  `do`/`run`), so on a fresh checkout the bootstrap must be able to run to install the
  deps that later make the pinned `node_modules/.bin/dorfl` exist. Mirror the existing
  `install-ci` CI shim, which forwards only `if [ -x node_modules/.bin/dorfl ]` and else
  falls back to the global (see observation
  `dorflcmd-forward-vs-prepare-ordering-node-modules-bin-not-installed-yet`). Accept +
  document the one-invocation skew: the command that RUNS `prepare` on a fresh checkout
  uses the bootstrap dorfl, not the pin (unavoidable — you cannot run a dorfl that isn't
  installed yet to install it). `npx dorfl@<version>` / a vendored `./bin/dorfl` have no
  such dependency (self-fetching / committed).
- **Fail-loud only when the target is PRESENT but the exec FAILS** (a real binary that
  spawn-errors or exits non-zero for a non-forwarding reason) — a CLEAR error naming the
  command + the `dorfl.json` path + how to bypass. A target that simply does not resolve
  yet is the DEGRADE case above, never fail-loud.
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
- [ ] A `dorflCmd` whose target does NOT EXIST YET (e.g. `node_modules/.bin/dorfl` before
      `prepare`/install) DEGRADES to the bootstrap/global dorfl and runs normally — NOT an
      error (so a fresh checkout can still run `prepare`, which dorfl itself runs). A test
      drives an absent `dorflCmd` path and asserts the bootstrap runs, no error.
- [ ] A `dorflCmd` that is PRESENT but exec-fails (a real binary that spawn-errors / exits
      non-zero for a non-forwarding reason) yields a clear, actionable error (names the
      command + `dorfl.json` path + the `--no-forward`/`DORFL_NO_FORWARD` bypass) and a
      non-zero exit. A test distinguishes this from the absent-degrades case.
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
> same `dorfl.json` runs in-process instead of forwarding again), ABSENT-target-DEGRADES
> (a `dorflCmd` path that does not exist yet — the `node_modules/.bin/dorfl`-before-prepare
> case — runs the bootstrap, NOT an error; mirror the existing `install-ci` shim's
> `if [ -x ... ]` existence check in `install-ci-core.ts`), PRESENT-but-exec-fails-fails-
> loud, stderr-only-notice (stdout uncorrupted for `--json`), and BOTH opt-outs
> (`DORFL_NO_FORWARD=1` env + `--no-forward` flag) disabling + silencing the forward.
>
> The absent-degrades rule is LOAD-BEARING: `prepare` (`pnpm install`) is run BY dorfl, so
> on a fresh checkout the bootstrap must run to install the deps that make a
> `node_modules/.bin/dorfl` pin exist — forwarding to an absent pin would brick the fresh
> checkout. Accept + document the one-invocation skew (the command that runs `prepare` uses
> the bootstrap, not the pin). See the observation
> `dorflcmd-forward-vs-prepare-ordering-node-modules-bin-not-installed-yet`.
>
> There is NO trust gate — honour `dorflCmd` verbatim (same trust as the committed
> `verify` command; see the spec §3). Exec transparently: inherit argv + env, propagate
> the child's exit code. Run `pnpm format && pnpm -r build && pnpm -r test` and add a
> changeset before finishing.
