---
title: review-gate non-blocking nits for 'surface-blockers-gate' (Gate 2 approve)
date: 2026-06-13
status: open
slug: surface-blockers-gate
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'surface-blockers-gate' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: explicit `advance <slug>`/`advance prd:<slug>` on a needsAnswers item BYPASSES the gate and surfaces regardless. The slice left this as a decision to RECORD (default: bypass, mirroring the other gates). The agent implemented bypass (explicit naming dispatches verbatim; the surface rung has no gate parameter) and tested it. Ratify the bypass default.
  (packages/agent-runner/src/advance.ts (surfaceRung has no surfaceBlockers param) + the two explicit-naming tests in test/surface-blockers-gate.test.ts. This is the slice's named decision; flagging for human ratification per the protocol, not a defect.)
- Coverage note: the slice's tests model the CLI selection RULE via a local helper (`surfaceGateFor`) and assert the resolution chain at the `resolveRepoConfig`/`doFlagOverrides` layer, but no in-repo test drives the real commander `advance --no-surface-blockers` end-to-end. The negatable-boolean default behaviour (key absent when no flag passed, so config/default wins) is therefore verified by reviewer-run experiment rather than a committed test. Consider whether an end-to-end CLI assertion is warranted, or accept the layered coverage as sufficient.
  (Unlike `autoBuild` (which needs a `getOptionValueSource('autoBuild')==='cli'` guard via `autoBuildFromCli`), `surfaceBlockers` relies on commander leaving the key absent. I confirmed commander@14.0.3 does leave it absent for a `--x`/`--no-x` pair when neither is passed, so the implementation is correct as written; this is a test-coverage observation, not a defect.)
