---
title: review-gate non-blocking nits for 'propose-pr-intent-guard-on-autonomous-paths' (Gate 2 approve)
date: 2026-06-14
status: open
slug: propose-pr-intent-guard-on-autonomous-paths
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'propose-pr-intent-guard-on-autonomous-paths' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The slice required a `## Decisions` block in the PR description, but the build sits in the working tree and the only commit is the claim, so there is no PR-description Decisions block. Will the Decisions be surfaced at PR time?
  (The three required decisions (probe placement per path: performDoRemote after mirror-resolve before claim, run after resolveRepoConfig/gitEnv before the CLAIM; reuse-not-fork the predicate+message; the probe not config is the signal so ambient-auth proceeds) ARE all documented thoroughly in the code comments at both new call sites, so the substance is captured. Only the required artifact location (PR description block) is unmet. Process/ratification, not a code defect.)
- Ratify: on the `run` path the autonomous refusal uses status `config-error`, which is summarised in the `failed` bucket. Is counting a propose-on-unauthed-gh pre-flight refusal among `failed` items the intended tick-summary semantics?
  (The slice explicitly offered `config-error` as an acceptable non-slice-fault status, and it is the most honest existing option since `run`'s ItemStatus has no `refused` member (that is a DoOutcome concept on the do path). The choice is well-grounded. The only user-visible consequence is that such refusals fall under `failed` rather than a distinct refused/skipped category in the run summary. Worth a human nod since it is a cross-path consistency choice (do uses outcome 'refused'; run uses status 'config-error').)
