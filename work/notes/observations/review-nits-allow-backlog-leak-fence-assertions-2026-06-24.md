---
title: review-gate non-blocking nits for 'allow-backlog-leak-fence-assertions' (Gate 2 approve)
date: 2026-06-24
status: open
reviewOf: allow-backlog-leak-fence-assertions
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'allow-backlog-leak-fence-assertions' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- The commit/PR has no '## Decisions' block, yet the agent made two in-scope judgement calls worth a human glance to ratify. (1) PRD Resolved-decision 5 left an OPTIONAL guard ('--allow-backlog MAY refuse loudly if the slug is also in ready/') to the builder's discretion as 'not load-bearing; the builder picks the cheaper'. This task is the leak-fence task (US #4); it neither asserts nor implements that optional refuse-if-also-ready behaviour, leaving the same-slug tie-break to resolveTask's ready-before-backlog precedence (decision 5's kept default). That is a defensible reading of scope (the guard belongs to the keystone resolver task, not the fence task), but the choice to NOT cover it here was unrecorded. (2) The task prompt instructed: 'If you find a path where the flag COULD leak into an autonomous claimer, fix it... do not just assert the happy path.' The agent found no leak and therefore shipped assertions only (no production change). That the fence was already structurally closed (so nothing needed fixing) is the expected outcome, but it is the load-bearing finding of the task and should be stated explicitly for the human rather than left implicit in an empty diff.
  (git log -1 --format=%B 1d244ca (single-line, no Decisions block); PRD decision 5; task ## Prompt 'do not just assert the happy path'. Diff = test file (+332) + task git mv to done/ (0 lines), no src/ change.)
