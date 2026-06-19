---
title: review-gate non-blocking nits for 'sweep-dead-surface-commit-path-after-lock-cutover' (Gate 2 approve)
date: 2026-06-19
status: open
reviewOf: sweep-dead-surface-commit-path-after-lock-cutover
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'sweep-dead-surface-commit-path-after-lock-cutover' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: failure-path message no longer names the arbiter (`push of <branch> FAILED — saved LOCALLY only` replaces `surface to <arbiter>/main FAILED; …`). Intentional consequence of removing the surface half — keep as-is?
  (`packages/agent-runner/src/do.ts` `routeReport` was simplified and the `arbiter`/`displayArbiter` parameter was removed from `routeReport`, `saveAgentFailure`, `saveAgentStop`, `saveRemoteAgentFailure`, and `runRemotePipeline`. `performDoRemote` no longer resolves `DEFAULT_ARBITER` at all. The slice mandated removing the surface report but did not explicitly call out dropping the arbiter name from failure messages; it should have been in a `## Decisions` block (PR body is empty).)
- Follow-up: prose drift — several doc-comments and one test name still say "surfaced on main" even though the assertion is on `stuckLockOnArbiter` (the lock is the surface now).
  (Examples: `src/do.ts:145` and `src/do.ts:2302` doc comments, `src/run.ts:1285`, the test title at `test/run.test.ts:732` ("agent-stopped, surfaced on main") and the inline comment at `test/run.test.ts:758` and `test/run-loop.test.ts:302`. Out of scope for this deletion slice but worth a housekeeping sweep.)
