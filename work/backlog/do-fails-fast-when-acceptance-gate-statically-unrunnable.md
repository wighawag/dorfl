---
title: do/run/complete should FAIL FAST at startup when the acceptance gate is statically unrunnable (verify unset, or fresh-worktree gate ON + prepare unset + a lockfile present) — not spend a full claim+build to discover an env-config gap and route CORRECT work to needs-attention
slug: do-fails-fast-when-acceptance-gate-statically-unrunnable
blockedBy: []
covers: []
---

## What to build

In a live `drive-backlog` run, the first slice was built CORRECTLY by the agent, then routed to `needs-attention/` for a reason that had nothing to do with the work: the fresh-worktree gate (`gate-on-rebased-tip-fresh-worktree`, ON by default) ran `verify` (`pnpm format:check && …`) in a CLEAN throwaway worktree that had no `node_modules`, because `.agent-runner.json` had no `prepare` step — so `prettier: not found`, exit 1, needs-attention. A whole `do` run (claim → build agent → gate) was spent to surface a STATIC misconfiguration knowable at second zero, and worse it routed correct work to needs-attention as if the WORK were at fault. See `work/observations/do-should-fail-fast-when-prepare-or-verify-unset.md`.

Add a pre-claim startup guard to `do` / `run` / `complete` (any command that ends in the acceptance gate): before claiming and before spawning the build agent, if the configured gate is STATICALLY guaranteed to be unrunnable, STOP with a precise, actionable error and a non-zero exit — do NOT claim, do NOT build, do NOT route work to needs-attention.

The two statically-detectable cases:

1. **`verify` unset entirely** while a command whose whole purpose ends in "the gate must pass" is invoked — refuse to start (the acceptance floor is missing).
2. **Fresh-worktree gate is ON (default) AND `prepare` is unset AND a dependency manifest implies an install is required** (a `pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` is present, i.e. `verify` will run tools from `node_modules/.bin`). A clean throwaway worktree provably has no `node_modules`, so the gate WILL fail with "command not found". STOP with: "fresh-worktree gate is on but no `prepare` step is configured; the throwaway worktree will have no installed deps — add a `prepare` (e.g. `pnpm install --frozen-lockfile`) or pass `--no-fresh-worktree-gate`".

CRITICAL non-regression (intentional design point in `src/config.ts`): `prepare` unset ⇒ NO prepare step is DELIBERATE ("a repo with no deps needs none; we never invent a default that would run `pnpm install` in a repo that has no lockfile"). So the guard MUST key off EVIDENCE that an install is needed (a lockfile present / `verify` invoking node-bin tools), and must NOT fire on a genuinely dep-free repo. The point is narrow: don't run an expensive pipeline to surface a precondition checkable for free.

## Acceptance criteria

- [ ] `do` / `run` / `complete` STOP BEFORE claiming (and before any build agent spawns) when `verify` is unset, with a clear message naming the missing config and a non-zero exit.
- [ ] They STOP BEFORE claiming when the fresh-worktree gate is ON, `prepare` is unset, AND a lockfile is detected — with the precise "add a prepare or pass --no-fresh-worktree-gate" message and a non-zero exit.
- [ ] A dep-free repo (no lockfile, no `prepare`) does NOT trip the guard — the intentional no-deps case is preserved. A test pins this.
- [ ] No CORRECT agent work is routed to needs-attention for this env-config reason any more: the guard fires at startup, so the claim/build never happens. A test asserts no claim occurs when the guard trips.
- [ ] The guard respects the resolution precedence (flag > env > per-repo > global > default) for `verify`/`prepare`/`freshWorktreeGate`; `--no-fresh-worktree-gate` (or supplying `prepare`/`verify`) clears the guard.
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None.

## Prompt

> FIRST, drift-check: re-read `src/config.ts` (the `prepare`/`verify` docblocks and the "unset prepare ⇒ no prepare step is intentional" note), the fresh-worktree-gate wiring (slice `gate-on-rebased-tip-fresh-worktree`, `--fresh-worktree-gate`/`--no-fresh-worktree-gate` in `src/cli.ts`/`src/do.ts`), and `work/observations/do-should-fail-fast-when-prepare-or-verify-unset.md`. If a startup precondition guard like this already exists, route to needs-attention noting that. Confirm where `do`/`run`/`complete` resolve config and claim, so the guard lands BEFORE the claim.
>
> GOAL: convert a wasted full `do` run + a mis-routed needs-attention into an instant, actionable startup error, WITHOUT regressing the deliberate dep-free `prepare`-unset case. Key the prepare-guard off evidence an install is required (lockfile present), not off `prepare`-unset alone.
>
> SEAM TO TEST AT: the config-resolution / pre-claim path with fixture repos — (a) lockfile present + no prepare + fresh gate on ⇒ STOP before claim; (b) verify unset ⇒ STOP before claim; (c) no lockfile + no prepare ⇒ proceeds (no guard); (d) `--no-fresh-worktree-gate` clears the prepare-guard. Assert no claim/build happens when the guard trips. No network.
>
> DONE: the guard fires only on statically-unrunnable gates, never on the intentional no-deps case, no correct work is routed to needs-attention for this reason, and `pnpm -r build && pnpm -r test && pnpm format:check` passes. Do NOT perform git transitions (no stage/commit/push, no folder moves) — the runner/human owns those.
