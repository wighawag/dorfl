---
'dorfl': minor
---

Make the global `dorfl` a thin bootstrap that self-forwards to the repo-declared `dorflCmd`.

On startup, BEFORE any command dispatch, `dorfl` reads the nearest repo `dorfl.json`; if it declares `dorflCmd` (added by `dorfl-cmd-config-field`) and we are not already the forwarded process, it `exec`s that command with the ORIGINAL argv + env inherited — after a one-line **stderr** notice — and exits with the child's exit code (transparent passthrough). This makes the taught, project-independent `dorfl` command reproducible + repo-owned instead of floating with whatever global dorfl a machine happens to have. This is the forward half of the `dorfl-self-version-pinning-and-bootstrap-forward` spec (stories 1, 4, 5).

Guards, all covered end-to-end:

- **Onboarding-safe:** NO `dorflCmd` ⇒ the bootstrap runs itself (`setup`/`install-ci` in a not-yet-pinned repo just work — never chicken-and-egg).
- **Loop-safe:** the forwarded child runs with a `DORFL_FORWARDED=1` env marker, so a forwarded dorfl reading the SAME `dorfl.json` runs in-process instead of forwarding again (a single hop).
- **Fail loud, never silent degrade:** a declared `dorflCmd` whose target does not resolve (e.g. `node_modules/.bin/dorfl` before the repo's dependency install) — or a present binary that spawn-errors — errors clearly, naming the `dorflCmd` value + the `dorfl.json` path + the fix (run the dependency install first) + the `--no-forward`/`DORFL_NO_FORWARD` bypass, with a non-zero exit. A working forward whose COMMAND merely exits non-zero (e.g. `verify` red) is passed through transparently, not treated as broken.
- **Non-recursive by design:** the forward decision fires ONCE, at bare-`dorfl` startup, in the checkout root. The gate worktree that runs `prepare`/`verify` is prepared by the already-running dorfl via `spawn('bash', ['-c', cmd])` — it never launches a new `dorfl`, so a fresh worktree's empty `node_modules` never re-triggers the forward.
- **Announced + opt-outable:** the notice goes to **stderr** only (stdout stays clean for `--json`); `DORFL_NO_FORWARD=1` OR `--no-forward` each disable AND silence the forward, honoured before dispatch (the `--no-forward` token is stripped before commander parses).

`dorflCmd` is honoured verbatim (no trust gate — the same trust as the committed `verify` command). The forward is an injectable seam (`bootstrap-forward.ts`: `decideForward` + `performForward` + `maybeForward`), unit-tested without re-execing a real second dorfl or hitting the network.
