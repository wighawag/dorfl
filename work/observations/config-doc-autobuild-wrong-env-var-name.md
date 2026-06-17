---
title: config.ts docblock for `autoBuild` names the WRONG env var (AGENT_RUNNER_AUTO_SLICE) in its precedence chain — should be AGENT_RUNNER_AUTO_BUILD
date: 2026-06-15
status: open
severity: low
needsAnswers: true
---

## The signal

`packages/agent-runner/src/config.ts:86` documents the `autoBuild` resolution precedence as:

```
`autoBuild`: flag > `AGENT_RUNNER_AUTO_SLICE` env > per-repo > global > …
```

That env var is wrong — it is the env var for `autoSlice`, not `autoBuild`. The ACTUAL env var for `autoBuild` is `AGENT_RUNNER_AUTO_BUILD`, confirmed by:

- `packages/agent-runner/src/build-slice-tick-template.ts:146` (`AGENT_RUNNER_AUTO_BUILD: 'true' # capability A: auto-build ready slices`) and its structural-validator assertion at line 342-344.
- `packages/agent-runner/src/env-config.ts` resolves `autoBuild` (the env layer that maps `AGENT_RUNNER_AUTO_BUILD` → `autoBuild`).

So the documented precedence chain for `autoBuild` cites `AGENT_RUNNER_AUTO_SLICE` where it should cite `AGENT_RUNNER_AUTO_BUILD` — a copy-paste slip in the docblock.

## How it surfaced

Flagged as a non-blocking Gate-2 nit during the `install-ci-build-slice-tick-workflow` build (PR #129), because that slice newly relies on the `AGENT_RUNNER_AUTO_BUILD`/`AGENT_RUNNER_AUTO_SLICE` env-block contract for the emitted CI workflow. It is PRE-EXISTING (not introduced by that slice), so it was captured rather than fixed in-place (golden rule 3: capture off-path findings, don't expand the slice).

## Why it's worth noting (not fixing now)

Docs-only, low severity — the CODE is correct (`env-config.ts` reads the right var); only the human-facing precedence comment is wrong. But it is exactly the kind of doc/code drift that misleads someone wiring CI env or debugging why `AGENT_RUNNER_AUTO_SLICE` doesn't toggle auto-build. A one-line fix.

## Fix (later)

In `config.ts:86`, change `AGENT_RUNNER_AUTO_SLICE` → `AGENT_RUNNER_AUTO_BUILD` in the `autoBuild` precedence chain. Verify the sibling `autoSlice` docblock correctly names `AGENT_RUNNER_AUTO_SLICE` while there. Trivial enough to fold into any nearby config docs touch-up rather than its own slice.
