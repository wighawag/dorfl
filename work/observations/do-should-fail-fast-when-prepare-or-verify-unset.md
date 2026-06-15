---
title: do/run/complete should fail fast at the START when the fresh-worktree gate has no prepare AND no node_modules will exist (or when verify is unset) — not waste a full build first
date: 2026-06-15
status: open
---

## The signal

During a `drive-backlog` run, the FIRST slice (`serialise-surface-treeless-moved-false-test-under-parallel-load`) was built **correctly** by the agent (the diff matched every acceptance criterion, zero `src/` changes), yet it routed to `needs-attention/` for a reason that had **nothing to do with the work**:

```
> Running the acceptance gate (prepare then verify) on the rebased tip in a clean throwaway worktree…
> prettier --check .
sh: 1: prettier: not found
 WARN   Local package.json exists, but node_modules missing, did you mean to install?
>> Routed '…' to needs-attention: acceptance gate failed (exit 1) on the rebased tip
```

Root cause: `.agent-runner.json` had **no `prepare` step**, so the fresh-worktree gate (`gate-on-rebased-tip-fresh-worktree`, ON by default) ran `verify` (`pnpm format:check && …`) in a CLEAN throwaway worktree that had no `node_modules`. `prettier` (and everything else) was absent, so the gate failed before it ever evaluated the agent's change. A whole `do` run (claim → build agent → gate) was spent to discover a **static config gap** that was knowable at second zero.

The fix for THIS repo was a one-line config add (`"prepare": "pnpm install --frozen-lockfile"`). But the run-cost was avoidable.

## The improvement

`do` / `run` / `complete` (and any command that will end in the fresh-worktree gate) should **fail fast at the START** — before claiming and before spawning the build agent — when the configured gate cannot possibly pass for an environmental reason it can detect up front:

- **The high-value, narrow guard:** if the **fresh-worktree gate is enabled** AND `prepare` is **unset** AND the repo has a dependency manifest that implies an install is required (a `pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` present, i.e. `verify` will run tools from `node_modules/.bin`), then a clean throwaway worktree provably has no `node_modules` and the gate WILL fail with "command not found". That is a deterministic, pre-claim STOP with a precise message ("fresh-worktree gate is on but no `prepare` step is configured; the throwaway worktree will have no installed deps — add a `prepare` (e.g. `pnpm install --frozen-lockfile`) or pass `--no-fresh-worktree-gate`").
- **The broader, simpler guard (the user's framing):** treat **`verify` unset** (and, when the fresh-worktree gate is on, **`prepare` unset alongside a lockfile**) as a startup precondition error rather than letting the command run a full build and only discover at gate-time that the acceptance floor is missing/unrunnable. A command whose whole purpose ends in "gate must pass" should refuse to start when the gate is statically guaranteed to be unrunnable.

Note the existing deliberate design point this must NOT regress: `prepare` unset ⇒ NO prepare step is INTENTIONAL (see `config.ts` — "a repo with no deps needs none; we never invent a default that would run `pnpm install` in a repo that has no lockfile"). So the guard must key off **evidence that an install IS needed** (lockfile present / `verify` invokes node-bin tools), not fire on every `prepare`-unset repo. The point is: don't run an expensive pipeline to surface a precondition that was checkable for free.

## Why it's worth noting (not fixing now)

It is off the path of the current drive (the drive just needed the config fixed), but it is a real ergonomic + cost defect: an isolated `do` spends a full claim + build-agent run to surface a static misconfiguration, and worse, it ROUTES correct agent work to `needs-attention/` as if the WORK were at fault, muddying the needs-attention signal (golden rule: "a `do` that delivers no code is not a success" has a mirror — "a `do` that fails the gate for an env reason is not a code failure"). A pre-claim guard converts a wasted hour into an instant, actionable error.

## Possible slice shape (later)

A small guard slice: in the `do`/`run`/`complete` startup path, after config resolution and before claim, if `freshWorktreeGate` is on and `prepare` is unset and a lockfile is detected (or `verify` is unset entirely), STOP with the precise message above and a non-zero exit. Test at the config-resolution seam with a fixture repo (lockfile present, no `prepare`) asserting the early STOP fires BEFORE any claim/build, and that a repo with no lockfile and no `prepare` does NOT trip the guard (preserve the intentional no-deps case).
