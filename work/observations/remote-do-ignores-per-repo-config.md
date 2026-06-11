---
title: `do --remote` IGNORES the target repo's per-repo `.agent-runner.json` (harness/verify/provider resolve from global+default only) — maybe by design, but the per-repo config could/should still be reachable
date: 2026-06-11
status: open
---

## The signal

Running `agent-runner do slice:<slug> --remote origin --arbiter origin` against THIS repo (which HAS a checkout and a committed `.agent-runner.json` declaring `harness: pi`, `verify: "pnpm format:check && pnpm build && pnpm test"`) failed immediately with:

```
error: no agentCmd configured — set `agentCmd` in config or pass --agent-cmd.
```

Root cause (CLI, `src/cli.ts` `do --remote` branch): the resolved comment says it outright —

> `do --remote <r>`: run against a REGISTERED repo with NO checkout. There is no per-repo `.agent-runner.json` to layer (the registered repo is a bare mirror), so config resolves from global + the SAME `do` flag overrides (flag > env > global > default).

So in `--remote` mode config is `resolveGlobalConfig(global, doFlagOverrides(...))` — the per-repo `.agent-runner.json` is **not read at all**. The global config here has only `identity` (no `harness`, no `agentCmd`), so `harness` defaults to `null`, the null adapter needs an `agentCmd`, there is none → the error. The repo's declared `harness: pi` was silently dropped.

Worked around for the drive by passing `--harness pi` explicitly on each invocation.

## Why it is (arguably) by design

`--remote` is built for a REGISTERED FOREIGN repo with NO local checkout — a bare hub mirror in the agents' area. In that model there is genuinely no working tree to read `.agent-runner.json` from at dispatch time, so resolving from global + flags is internally consistent.

## The `verify` gate divergence is NOT benign here (correcting an earlier assumption)

I initially assumed the unset-global `verify` fallback `DEFAULT_VERIFY_COMMAND` (`pnpm -r build && pnpm -r test && pnpm -r format:check`) was equivalent to this repo's declared gate. It is NOT. This repo's per-repo `verify` is `pnpm format:check && pnpm build && pnpm test` — note `format:check` is run at the ROOT (no `-r`), because the `format:check` script lives only in the ROOT `package.json`, not in the workspace packages. The default uses `pnpm -r format:check`, which recurses into `packages/*` and fails:

```
ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT  None of the selected packages has a "format:check" script
```

So on the SECOND `--remote` build (`null-harness-prompt-write-epipe-tolerant`), the actual WORK was fine (build + 1327 tests all passed), but the gate's `pnpm -r format:check` step failed purely on the command-shape mismatch, and the slice was routed to `work/needs-attention/` — a FALSE red. This makes the per-repo-config gap materially harmful, not just confusing: `--remote` ran a DIFFERENT (and for this repo, broken) acceptance gate than the repo declares. Both `harness` (→ "no agentCmd") AND `verify` (→ false gate red) bit us; only `--harness pi` + an explicit `--verify`/per-repo read would fix it.

## Why it is still a gap worth closing

The per-repo `.agent-runner.json` is, by the repo-config design's OWN words (`src/repo-config.ts`), the place where *"repo-local properties (how this repo integrates, its acceptance `verify` gate, which remote arbitrates its claims) are agreed by all collaborators and agents rather than living in one person's global config."* `harness` and `model` are EXPLICITLY whitelisted as legitimate per-repo keys there (a repo may prefer a given harness). So a `do --remote` that ignores that file is dropping exactly the cross-collaborator agreement the per-repo file exists to carry — and silently: nothing warns that `harness: pi` was discarded, you just get a confusing "no agentCmd" error.

The committed `.agent-runner.json` IS available on the arbiter — it's a tracked file on `origin/main`, and `--remote` materialises a hub mirror + cuts a job worktree off that main. So the per-repo config is REACHABLE; the resolution just doesn't read it.

## Possible fix shapes (for later — do not implement now)

1. **Read the per-repo `.agent-runner.json` from the mirror/job-worktree's main.** After `--remote` materialises the job worktree (or even from the bare mirror via `git show origin/main:.agent-runner.json`), layer the repo's whitelisted per-repo keys (`harness`, `verify`, `provider`, `model`, `defaultArbiter`, …) INTO the resolution — restoring `flag > env > per-repo > global > default` parity with in-place `do`. This is the most faithful: the repo's declared harness/gate is honoured even with no human checkout. The host-only keys (`agentCmd`, `piBin`, `maxParallel`) stay global-only exactly as `repo-config.ts` already enforces.
2. **At minimum, WARN loudly** when `--remote` drops a per-repo file it could see (e.g. mirror's main has `.agent-runner.json` with a `harness` that differs from the resolved one) — turn the silent "no agentCmd" confusion into an explicit "per-repo `.agent-runner.json` is not applied in `--remote` mode; pass `--harness …` or set it globally."
3. **Document it** in `do --help` / the ADR so the divergence is at least discoverable (today it's only a code comment).

Option 1 (layer the per-repo config read from the arbiter's main) is the most desirable: it makes `--remote` honour the repo's agreed harness/gate, which in turn unblocks making `--remote` the conductor's default build mode (see `drive-backlog-skill-assumes-in-place-do-not-remote.md`, whose open question is gated on exactly this).

## Where

`src/cli.ts` — the `do --remote` branch (`flags.remote !== undefined`): `resolveGlobalConfig(global, doFlagOverrides(...))` with no per-repo layer. Compare the IN-PLACE `do` branch, which DOES layer `resolveRepoConfig(cwd, …)`. `src/repo-config.ts` defines the per-repo-honoured key set (incl. `harness`, `model`, `verify`, `provider`) vs the host-only rejected set (`agentCmd`, `piBin`, …). Cross-ref: `drive-backlog-skill-assumes-in-place-do-not-remote.md`.
