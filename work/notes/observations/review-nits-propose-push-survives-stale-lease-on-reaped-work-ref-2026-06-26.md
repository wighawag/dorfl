---
title: review-gate non-blocking nits for 'propose-push-survives-stale-lease-on-reaped-work-ref' (Gate 2 approve)
date: 2026-06-26
status: open
reviewOf: propose-push-survives-stale-lease-on-reaped-work-ref
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'propose-push-survives-stale-lease-on-reaped-work-ref' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- No '## Decisions' block was recorded in the PR/commit/done body, though the task prompt explicitly asked for one. The in-scope decisions are well-documented in JSDoc (sibling helper vs reusing the continue helper verbatim; placement in continue-branch.ts; new IntegrateResult.alreadyLanded field; instruction-text shape; ls-remote-based observation rather than refs/remotes upstream) but should be ratified by the human.
  (task says: 'RECORD non-obvious in-scope decisions ... An un-recorded in-scope decision is a review FINDING.' Commit bdbf71ec has empty body; no Decisions block on the done task file.)
- complete.ts unconditionally calls formatProposeNextStep with requestOpened from the integrate result and ignores the new alreadyLanded flag — so a user running 'dorfl complete --propose' that hits the benign already-landed race tail will be told 'Pushed work/<branch> to arbiter/work/<branch>. Open a PR/MR ...' when in fact nothing was pushed and there is no ref to PR against. The integrator.instruction text is set but unused on this path. The CI-dominant recovery path goes through performIntegration/integration-core rather than complete.ts, so the originally-observed RED is fixed; this is a residual UX misreport on a sibling caller.
  (packages/dorfl/src/complete.ts around lines 1095-1110 vs integrator.ts already-landed branch (lines 425-435) that sets alreadyLanded:true + a custom instruction.)
- Coherence: pushProposeBranchWithStaleLeaseRetry now lives inside continue-branch.ts, which previously named the continue/onboard caller. The file is becoming a multi-caller 'stale-lease work-branch push' module; consider renaming or splitting so the file name still matches its contents (or document the broadened scope at the top of the file).
  (packages/dorfl/src/continue-branch.ts diff adds a propose-specific helper alongside pushContinuedBranchWithStaleLeaseRetry; the integrator imports the new helper from './continue-branch.js'.)
