---
title: do/run/complete should FAIL FAST at startup when the fresh-worktree gate is statically unrunnable (fresh-worktree gate ON + prepare resolves to no commands + a lockfile present) — not spend a full claim+build to discover the env-config gap and route CORRECT work to needs-attention
slug: do-fails-fast-when-acceptance-gate-statically-unrunnable
blockedBy: []
covers: []
---

## What to build

In a live `drive-backlog` run, the first slice was built CORRECTLY by the agent, then routed to `needs-attention/` for a reason that had nothing to do with the work: the fresh-worktree gate (`gate-on-rebased-tip-fresh-worktree`, ON by default) ran `verify` (`pnpm format:check && …`) in a CLEAN throwaway worktree that had no `node_modules`, because `.agent-runner.json` had no `prepare` step — so `prettier: not found`, exit 1, needs-attention. A whole `do` run (claim → build agent → gate) was spent to surface a STATIC misconfiguration knowable at second zero, and worse it routed correct work to needs-attention as if the WORK were at fault. See `work/observations/do-should-fail-fast-when-prepare-or-verify-unset.md`.

Add a pre-claim startup guard to `do` / `run` / `complete` (any command that ends in the acceptance gate): before claiming and before spawning the build agent, if the gate is STATICALLY guaranteed to be unrunnable in a fresh worktree, STOP with a precise, actionable error and a non-zero exit — do NOT claim, do NOT build, do NOT route work to needs-attention.

### VERIFIED against the code (full read of `prepare.ts` + `verify.ts` — do not re-derive; corrects an earlier draft)

The earlier draft listed "verify unset" as a SEPARATE guard case. THAT IS WRONG and must not be built: `resolveVerifyCommands` (`verify.ts` ~L40) returns `DEFAULT_VERIFY_COMMAND` (`pnpm -r build && test && format`) whenever `verify` is unset OR resolves to an all-blank list. So `verify` is NEVER actually unrunnable-because-unset — it always resolves to a command. A "verify unset → STOP" guard would be dead code (never fires) or fire wrongly on the default. DROP that case.

So there is exactly ONE statically-detectable unrunnable case, and it is about DEPS, not about verify being unset:

- **Fresh-worktree gate is ON (default) AND `prepare` resolves to NO commands AND a dependency manifest implies an install is required.** The fresh-worktree gate runs `prepare` then `verify` in a CLEAN throwaway worktree with no `node_modules`. If `prepare` resolves to nothing (`resolvePrepareCommands` returns `[]` — covering BOTH `prepare` unset AND an all-blank list, per `prepare.ts`), the worktree never installs deps; and the verify command (the repo's own OR `DEFAULT_VERIFY_COMMAND`) runs tools from `node_modules/.bin` (`pnpm`/`prettier`/`tsc`/`vitest`). A lockfile present (`pnpm-lock.yaml` / `package-lock.json` / `yarn.lock`) is the EVIDENCE that an install is required, so the gate WILL fail with "command not found". STOP with: "the fresh-worktree gate is on but no `prepare` step is configured, and a lockfile (<which>) is present — the throwaway worktree will have no installed deps, so the gate cannot run. Add a `prepare` (e.g. `pnpm install --frozen-lockfile`) or pass `--no-fresh-worktree-gate`."

CRITICAL non-regression (intentional design point in `prepare.ts` + `config.ts`): `prepare` resolving to no commands is a DELIBERATE no-op ("a repo with no deps needs none; we never invent a default that would run `pnpm install` in a repo that has no lockfile"). So the guard MUST key off the LOCKFILE-PRESENT evidence, and MUST NOT fire on a genuinely dep-free repo (no lockfile). The point is narrow: don't run an expensive pipeline to surface a precondition checkable for free.

> SCOPE-NOTE on `complete`: `complete --isolated` finishing a stranded branch ALSO runs the fresh-worktree gate, so the guard applies. But plain in-place `complete` runs the gate in the CURRENT checkout (which normally HAS `node_modules`), so the fresh-worktree-deps reasoning does not apply there — the guard must be gated on the fresh-worktree gate actually being ON for this invocation, not on the command name.

## Acceptance criteria

- [ ] **There is NO "verify unset" guard** (verify always resolves to `DEFAULT_VERIFY_COMMAND`, so that case cannot occur). A test/comment documents that the guard is deps-only, not verify-presence.
- [ ] `do` / `run` (and `complete` WHEN the fresh-worktree gate is ON for the invocation) STOP BEFORE claiming (and before any build agent spawns) when: the fresh-worktree gate is ON AND `resolvePrepareCommands(prepare)` is empty AND a lockfile is detected — with the precise "add a prepare or pass --no-fresh-worktree-gate" message (naming WHICH lockfile) and a non-zero exit.
- [ ] The guard fires for BOTH `prepare` unset AND an all-blank `prepare` list (both resolve to no commands via `resolvePrepareCommands`). A test pins the all-blank case too.
- [ ] A dep-free repo (NO lockfile, no `prepare`) does NOT trip the guard — the intentional no-deps case is preserved. A test pins this.
- [ ] When the fresh-worktree gate is OFF (`--no-fresh-worktree-gate`), the guard does NOT fire even with no `prepare` + a lockfile (the gate then runs in the agent's build worktree, which HAS deps). A test pins this.
- [ ] No CORRECT agent work is routed to needs-attention for this env-config reason any more: the guard fires at startup, so the claim/build never happens. A test asserts no claim occurs when the guard trips.
- [ ] The guard respects the resolution precedence (flag > env > per-repo > global > default) for `prepare`/`freshWorktreeGate`; supplying a `prepare` clears the guard.
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None.

## Prompt

> FIRST, drift-check: re-read `src/prepare.ts` (`resolvePrepareCommands` — unset OR all-blank ⇒ `[]`, a deliberate no-op), `src/verify.ts` (`resolveVerifyCommands` — unset ⇒ `DEFAULT_VERIFY_COMMAND`, so verify is NEVER unrunnable-because-unset — do NOT add a verify-unset guard), the fresh-worktree-gate wiring (slice `gate-on-rebased-tip-fresh-worktree`, `--fresh-worktree-gate`/`--no-fresh-worktree-gate` in `src/cli.ts`/`src/do.ts`), and `work/observations/do-should-fail-fast-when-prepare-or-verify-unset.md`. If a startup precondition guard like this already exists, route to needs-attention noting that. Confirm where `do`/`run`/`complete` resolve config and claim, so the guard lands BEFORE the claim, and that the guard is gated on the fresh-worktree gate being ON for THIS invocation.
>
> GOAL: convert a wasted full `do` run + a mis-routed needs-attention into an instant, actionable startup error, WITHOUT regressing the deliberate dep-free `prepare`-unset case. Key the prepare-guard off evidence an install is required (lockfile present), not off `prepare`-unset alone.
>
> SEAM TO TEST AT: the config-resolution / pre-claim path with fixture repos — (a) lockfile present + no prepare + fresh gate on ⇒ STOP before claim; (b) verify unset ⇒ STOP before claim; (c) no lockfile + no prepare ⇒ proceeds (no guard); (d) `--no-fresh-worktree-gate` clears the prepare-guard. Assert no claim/build happens when the guard trips. No network.
>
> DONE: the guard fires only on statically-unrunnable gates, never on the intentional no-deps case, no correct work is routed to needs-attention for this reason, and `pnpm -r build && pnpm -r test && pnpm format:check` passes. Do NOT perform git transitions (no stage/commit/push, no folder moves) — the runner/human owns those.
