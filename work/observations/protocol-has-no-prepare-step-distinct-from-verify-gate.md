---
title: the protocol has no "prepare/bootstrap" concept distinct from the `verify` gate — a fresh clone/worktree has no defined way to install deps before verify runs, so install leaks into `verify`
date: 2026-06-09
kind: observation
area: .agent-runner.json (verify) + the runner's fresh-worktree lifecycle
severity: medium
status: open
---

## The signal

The `verify` gate in `.agent-runner.json` is defined as the per-repo **acceptance** command (build + test + lint, all green). But nothing in the protocol defines a **prepare/bootstrap** step — install dependencies, fetch git submodules, run codegen — that must happen **before** `verify` can pass on a _fresh_ clone or worktree.

Consequences observed:

- On a real migrate run (rocketh), the detected `verify` was `pnpm install --ignore-scripts && pnpm build && pnpm test && pnpm format:check` \u2014 i.e. **install got baked into the gate** because there was nowhere else for it to go (and CI happened to run it as a step). That conflates two concerns: "is the tree green?" (verify) vs "is the environment ready?" (prepare).
- The runner builds in isolated worktrees/clones (ADR `execution-substrate-decisions` §2: hub mirror + external worktrees). A fresh worktree has **no `node_modules`** (or vendored deps) until something installs them. If `verify` assumes deps are present, it fails on a fresh worktree; if `verify` installs them itself, every gate run pays the install cost and the gate stops being a pure acceptance check.

## Why it matters

This is a **protocol-design gap**, not a one-off skill bug. Every consumer repo with a dependency-install step hits it. The `setup`/`migrate` skills now say "the gate is acceptance, not env-prep; strip install prefixes" \u2014 but that instruction is only honest if the protocol _also_ provides where the prepare step lives. Right now it does not, so the skills are telling authors to remove install from `verify` with no sanctioned home for it.

## Proposed direction (for a human to decide; NOT yet implemented)

Options to consider:

1. **Add a `prepare` field to `.agent-runner.json`** (e.g. `"prepare": "pnpm install"`) that the runner runs ONCE per fresh worktree/clone before the first `verify`, and not again per change. Clean separation; mirrors CI's install-then-test split.
2. **Make it the runner's responsibility** to detect+install per ecosystem (lockfile present \u2192 run the matching install) with no config \u2014 less explicit, more magic.
3. **Document that `verify` MAY assume a prepared env** and that preparing it is out of protocol scope (the caller/CI/runner handles it) \u2014 the minimal stance, but leaves the fresh-worktree path undefined for the autonomous runner.

Whichever is chosen, the `setup` gate-shape rule ("strip install from verify") should point at the sanctioned prepare mechanism so authors know where install belongs.

## Provenance

Spotted 2026-06-09 reviewing a migrate run on rocketh: the auto-detected `verify` baked in `pnpm install --ignore-scripts`, which prompted the question "does the protocol tackle install / what happens on a fresh clone?". The answer is: it doesn't, currently.
