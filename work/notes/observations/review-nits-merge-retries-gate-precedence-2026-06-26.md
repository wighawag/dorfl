---
title: review-gate non-blocking nits for 'merge-retries-gate-precedence' (Gate 2 approve)
date: 2026-06-26
status: open
reviewOf: merge-retries-gate-precedence
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'merge-retries-gate-precedence' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: the new default is 1000 (the engine's existing DEFAULT_MERGE_RETRIES), not the '5' the prd's lens-1 paragraph still cites. The task said 'keep the modest default' and the agent picked the engine's real default so behaviour is byte-for-byte unchanged when nothing sets it — but the prd text is now stale. Either ratify 1000 as the modest default and update the prd, or pick a smaller modest default.
  (packages/dorfl/src/config.ts mergeRetries: 1000 + DEFAULT_MERGE_RETRIES=1000 in integration-core.ts; prd line 158 still says DEFAULT_MERGE_RETRIES = 5)
- Ratify the cross-task scope: only the run/do/complete entry points were threaded. `tasking.ts:632`, `intake.ts:1157` + `:1297`, and `recover-isolated.ts:169` also call performIntegration and may run in merge mode, but none forward a resolved mergeRetries, so on those paths a per-repo / env / flag cap is silently lost (the engine default takes over). Probably acceptable (those paths are rarely in merge mode and behaviour is unchanged at default), but it is a real cross-task seam the task prompt did not name.
  (grep performIntegration in src/*.ts — only complete.ts/do.ts/run.ts thread options.mergeRetries)
- No Decisions block was surfaced for the human: the commit/PR body is empty, and the in-scope decisions (chose 1000 as the modest default; flag parse-or-drop on negatives/non-integers/'' mirroring --review-max-rounds; resolved ONCE per performComplete; intake/tasking/recover not threaded) should have been listed for ratify.
  (git log -1 74f3899d --format=%B has no body)
