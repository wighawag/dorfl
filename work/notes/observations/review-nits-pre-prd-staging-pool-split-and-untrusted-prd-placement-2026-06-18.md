---
title: review-gate non-blocking nits for 'pre-prd-staging-pool-split-and-untrusted-prd-placement' (Gate 2 approve)
date: 2026-06-18
status: open
reviewOf: pre-prd-staging-pool-split-and-untrusted-prd-placement
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'pre-prd-staging-pool-split-and-untrusted-prd-placement' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: missing `## Decisions` block. The slice prompt explicitly asked for the `prdsLandIn` key + resolver-reuse decision to be recorded; the slice file and commit body carry none. The choices made (built-in floor `pre-prd`; flag `--prds-land-in`; env `AGENT_RUNNER_PRDS_LAND_IN`; resolver REUSED, not forked; slot mapping `{staging:'pre-prd', pool:'prd'}`) match the prompt — please ratify and capture them somewhere durable.
  (slice prompt: "Record the `prdsLandIn` key + any reuse-vs-fork decision on the resolver as a `## Decisions` note (or an ADR if it meets the gate)." The diff implements the intended reuse; the bookkeeping note is what is missing.)
- Ratify: no operator CLI surface for `promoteFromPrePrd`. Mirrors the prior `promoteFromPreBacklog` (also exposed as function only). Intentional parity, or expected to be added by a follow-up that wires both promotions to a single verb?
  (`packages/agent-runner/src/needs-attention.ts` exports `promoteFromPrePrd`, but `grep -n promote packages/agent-runner/src/cli.ts` shows no command registration. The slice acceptance only requires that an agent cannot promote, which is satisfied; but a human invocation path is not surfaced either.)
- Ratify cross-slice interaction: `close-job` continues to scan only `work/prd/` + `work/prd-sliced/`, so an `intake`-authored PRD that lands STAGED in `work/pre-prd/` carrying `issue: N` will not auto-close its originating issue until promoted. Almost certainly the intended semantics (a staged PRD is not yet live), but it is a user-visible behaviour shift vs the pre-slice baseline where the PRD was instantly live in the pool.
  (`packages/agent-runner/src/close-job.ts:57` `PRD_FOLDERS = ['prd','prd-sliced']`. With the new built-in floor `prdsLandIn: 'pre-prd'`, every default-config repo now defers issue auto-closure until a promotion happens.)
