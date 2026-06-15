---
title: review-gate non-blocking nits for 'per-transition-integration-mode-slicing-vs-build' (Gate 2 approve)
date: 2026-06-15
status: open
slug: per-transition-integration-mode-slicing-vs-build
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'per-transition-integration-mode-slicing-vs-build' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the optional `--slicing-integration` CLI flag was deliberately NOT added; the new key resolves only via per-repo/global config and the `AGENT_RUNNER_SLICING_INTEGRATION` env var. Is config+env parity sufficient, or do you want the CLI flag for symmetry with `--merge`/`--propose`?
  (The slice marked the `--slicing-integration` flag as MAY ('the per-repo config key is the slice's core deliverable'). `grep` confirms no such flag exists in cli.ts. Explicit `--merge`/`--propose` still override the slicing transition via the do-config flag-fold, so there is no functional gap for the operator who types a flag, only no dedicated per-transition flag.)
- Ratify the precedence mechanism: an explicit `--merge`/`--propose` flag sets BOTH `integration` AND `slicingIntegration` in `doFlagOverrides` (do-config.ts L118-119), so the typed flag wins for the slicing transition even though the slicing path reads `slicingIntegration ?? integration`. On a build run this also sets `slicingIntegration`, which is harmless (the build path reads only `integration`). Confirm this dual-set is the intended way the transition-agnostic flag wins.
  (do-config.ts L107-120 sets both keys to the flag mode. The build path threads plain `integration` (do.ts L987/L2062/L2279), so a flag-set `slicingIntegration` never leaks into build behaviour. do-config.test.ts and the do.test.ts 'explicit slicing mode wins' case cover this. The commit has no `## Decisions` block, so this design choice was not author-recorded.)
