---
title: review-gate non-blocking nits for 'dorfl-bootstrap-self-forward' (Gate 2 approve)
date: 2026-07-21
status: open
reviewOf: dorfl-bootstrap-self-forward
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'dorfl-bootstrap-self-forward' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- defaultForwardSpawn maps a child exit status of 127 to a spawn-error (broken/absent pin). A forwarded command that legitimately exits 127 for its OWN reason (not command-not-found) would be misreported as a broken pin instead of passed through. Ratify this heuristic or narrow it to only spawn errors + shell not-found.
  (bootstrap-forward.ts defaultForwardSpawn: if (result.status === 127) return spawn-error. In-scope decision not recorded in a Decisions block.)
- An unparseable/invalid dorfl.json now FAILS LOUD at the bootstrap forward hook (maybeForward catches the reader throw and returns error) rather than degrading to run-self. This is a new refusal path affecting EVERY command in a repo with a malformed config. Ratify — it seems right (a broken pin config should not be masked) but was not called out as a decision.
  (bootstrap-forward.ts maybeForward try/catch around decideForward; test 'a malformed dorfl.json (reader throws) FAILS LOUD'.)
- stripNoForwardFlag removes EVERY --no-forward token globally from argv before commander parses. No current subcommand takes --no-forward as a value, so harmless today, but a future command that did would silently lose it. Non-issue now; flagging the cross-command interaction.
  (bootstrap-forward.ts stripNoForwardFlag filters all occurrences; cli.ts passes outcome.argv to commander.)
