---
title: review-gate non-blocking nits for 'recovery-rebase-retry-against-moving-arbiter-main' (Gate 2 approve)
date: 2026-06-24
status: open
reviewOf: recovery-rebase-retry-against-moving-arbiter-main
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'recovery-rebase-retry-against-moving-arbiter-main' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Acceptance criterion 'A `## Decisions` block records: cap chosen and why; contention-vs-outage; jitter; reconcile-arms decision; rename-detection orthogonality' was required in the done record / PR / ADR. The done task file (`work/tasks/done/recovery-rebase-retry-against-moving-arbiter-main.md`) carries no `## Decisions` block, the commit body is empty, and there is no PR yet. The decisions ARE thoroughly recorded — but in code comments inside `integration-core.ts` (the DEFAULT_RECOVERY_REBASE_RETRIES doc-comment, DEFAULT_RECOVERY_REBASE_JITTER_MS doc-comment, and the long block above the retry loop). Transcribe them into a `## Decisions` block on the done task file (or PR description) so the protocol-native location is honoured.
  (work/tasks/done/recovery-rebase-retry-against-moving-arbiter-main.md (no '## Decisions' heading); commit d1ab93c body is empty; vs task line 202 acceptance criterion.)
- Ratify the chosen cap: `DEFAULT_RECOVERY_REBASE_RETRIES = 4` (5 total attempts). Task says 'small bounded cap … a few attempts ride out an advance burst'; 4 is plausible but picked without an empirical anchor (the live incident report quantifies bursts only qualitatively as 'tens of commits over a few seconds'). Reasonable; flagging for human ratification per protocol since the value lands in default behaviour.
  (packages/agent-runner/src/integration-core.ts:247 (DEFAULT_RECOVERY_REBASE_RETRIES = 4); contrast Race-1 cap of 1000 (a liveness ceiling, deliberately different shape).)
- Ratify the in-scope reconcile-arms decision: the recovery re-rebase is left BARE (no `rebaseOntoMainWithReconcile()` arms), with the rationale that the done-move was already committed upstream so divergent-done-move has nothing to act on, and a sibling-ledger conflict on a re-fetched main is the same shape the original run would have hit. Reasoning is sound and recorded in the source comment, but the decision is load-bearing — please confirm.
  (packages/agent-runner/src/integration-core.ts (block-comment above the retry loop, 'RECONCILE ARMS DECISION (this task): the recovery rebase is deliberately BARE …').)
- Cross-task interaction with the still-OPEN PR #224 `disable-rename-detection-on-continue-rebase`: both tasks edit rebase invocation sites in `integration-core.ts`. This task wrote the rebase call as a `rebaseArgs()` thunk explicitly to let rename-off 'slot in cleanly at ONE site' (good), and the done record should state 'sibling has NOT landed yet' per the task's instruction. That sibling-landed/not-landed line is not in the task body. Whoever merges second must add `-c merge.renames=false` / `-Xno-renames` to this one args site and run the moving-base tests with renames off.
  (`gh pr list` shows PR #224 OPEN as of 2026-06-24; integration-core.ts has the rebaseArgs thunk + comment but task body lacks the 'state which case held' note required by acceptance line.)
- Minor module-local inconsistency: the Race-1 jitter still uses the local non-injectable `sleepMs` (kept 'for byte-for-byte compatibility with existing tests'), while the new recovery loop uses the `Sleep` seam from `retry-backoff.ts`. Two sleep primitives now coexist in one module. Acceptable as a localised choice; worth a follow-up note to unify the Race-1 jitter onto the same `Sleep` seam when convenient (the new recovery seam is strictly better — RNG also injected).
  (packages/agent-runner/src/integration-core.ts: sleepMs vs realSleep/Sleep used in recoverAlreadyCommitted; doc-comment on sleepMs explicitly notes the split.)
