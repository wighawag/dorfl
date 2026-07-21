---
title: Bare `dorfl` self-forwards to the repo-declared `dorflBin` (announced, opt-outable)
slug: dorfl-bootstrap-self-forward
spec: dorfl-self-version-pinning-and-bootstrap-forward
blockedBy: [dorfl-bin-config-field]
covers: [1, 4, 5]
---

## What to build

Make the globally-installed `dorfl` a thin BOOTSTRAP that self-forwards to a
repo-declared `dorflBin`. On startup, BEFORE any command dispatch, the running `dorfl`
reads the nearest repo `dorfl.json`; if it declares `dorflBin` AND that command is not
the process already running, it `exec`s the command with the ORIGINAL argv + env
inherited, after a one-line **stderr** notice. The forwarded process's exit code is the
bootstrap's exit code (transparent passthrough).

Guards, all end-to-end in this one vertical task:

- **Onboarding-safe:** NO `dorflBin` declared ⇒ the bootstrap runs ITSELF (so `setup` /
  `install-ci` in a not-yet-pinned repo just work — never chicken-and-egg).
- **Loop-safe:** the forwarded dorfl reads the SAME `dorfl.json` and must NOT forward
  again forever. Detect "this command IS me / already forwarded" and run in-process
  rather than re-exec (e.g. an env marker set on the child, and/or a same-target check).
- **Fail-loud:** a `dorflBin` that cannot be run (missing binary, spawn failure) is a
  CLEAR error naming the command + the `dorfl.json` path + how to bypass — never a silent
  fall-through to the skewed global.
- **Announced:** one line to **stderr** (never stdout — must not corrupt `--json`),
  e.g. `dorfl: forwarding to `<cmd>` (from <path>/dorfl.json)`.
- **Opt-out (both forms):** `DORFL_NO_FORWARD=1` OR a CLI flag `--no-forward` DISABLES
  forwarding (run the bootstrap/global as-is) AND suppresses the notice. Both are honoured
  BEFORE dispatch so a user can always reach the bootstrap dorfl directly.

## Acceptance criteria

- [ ] With a `dorflBin` set to a different command, bare `dorfl <args>` execs that command
      with argv + env passed through and returns its exit code.
- [ ] With NO `dorflBin`, the bootstrap runs itself unchanged (byte-for-byte today's
      behaviour) — a test proves no forward path is taken.
- [ ] Re-entrancy: the forwarded process does not forward again (no infinite loop) — a
      test drives a `dorflBin` that points back at dorfl and asserts a single hop.
- [ ] A broken `dorflBin` (nonexistent command) yields a clear, actionable error (names
      the command + `dorfl.json` path + the `--no-forward`/`DORFL_NO_FORWARD` bypass) and
      a non-zero exit — NOT a silent run of the global.
- [ ] The notice goes to STDERR only; a `--json`-producing command's STDOUT is uncorrupted
      when a forward happens (assert stdout is exactly the forwarded stdout).
- [ ] `DORFL_NO_FORWARD=1` and `--no-forward` each disable forwarding + suppress the
      notice; both are recognised before command dispatch (a test for each).
- [ ] Tests drive the exec via an injectable seam (a stubbed spawn/exec) — no real
      re-exec of a second dorfl, no network. Fixtures isolate `dorfl.json` in a scratch
      dir; no shared location written.

## Blocked by

- `dorfl-bin-config-field` — the bootstrap reads the `dorflBin` field this adds.

## Prompt

> Turn the global `dorfl` into a thin bootstrap that self-forwards to the repo-declared
> `dorflBin` (added by the blocking task `dorfl-bin-config-field`). Read the spec
> `dorfl-self-version-pinning-and-bootstrap-forward` Solution §2 and §4 — this task
> covers stories 1, 4, 5.
>
> The hook is the CLI entry, BEFORE command dispatch: in `cli.ts` the program builds its
> commander tree and calls `program.parseAsync(argv)` near the end — the forward decision
> must happen before that (or before any command action runs), reading the nearest repo
> `dorfl.json` via the existing repo-config resolution (`resolveRepoConfigPath` /
> `REPO_CONFIG_FILENAME` in `repo-config.ts`) and the `dorflBin` field.
>
> Design the forward as an INJECTABLE seam (a function that takes the resolved `dorflBin`
> + argv + env + an exec/spawn function) so it is unit-testable WITHOUT re-execing a real
> second dorfl or hitting the network — mirror how the codebase already injects git/agent
> seams in tests. Cover, end to end: forward-happens, no-`dorflBin`-runs-self,
> re-entrancy-single-hop (set an env marker on the child so the forwarded dorfl reading the
> same `dorfl.json` runs in-process instead of forwarding again), broken-`dorflBin`-fails-
> loud, stderr-only-notice (stdout uncorrupted for `--json`), and BOTH opt-outs
> (`DORFL_NO_FORWARD=1` env + `--no-forward` flag) disabling + silencing the forward.
>
> There is NO trust gate — honour `dorflBin` verbatim (same trust as the committed
> `verify` command; see the spec §3). Exec transparently: inherit argv + env, propagate
> the child's exit code. Run `pnpm format && pnpm -r build && pnpm -r test` and add a
> changeset before finishing.
