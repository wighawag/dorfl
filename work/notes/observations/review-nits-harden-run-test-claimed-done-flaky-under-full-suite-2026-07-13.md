---
title: review-gate non-blocking nits for 'harden-run-test-claimed-done-flaky-under-full-suite' (Gate 2 approve)
date: 2026-07-13
status: open
reviewOf: harden-run-test-claimed-done-flaky-under-full-suite
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'harden-run-test-claimed-done-flaky-under-full-suite' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: agent chose NOT to fix the duplicate local gitEnv() in packages/dorfl/test/prd-to-spec.test.ts even though its ENOTEMPTY teardown race reproduced during the 3-run acceptance loop (run 2 red-bounced there). Agent dropped a sibling observation instead, citing the task's 'do not expand scope' guidance. Task's earlier widened Done-when mentioned the ENOTEMPTY race should be gone; the re-scope narrowed focus to the claimed-done line, so this is defensible — but worth ratifying vs. asking for the one-line helper import in-scope.
  (work/notes/observations/prd-to-spec-test-has-duplicate-local-gitenv-missing-gc-auto-off-fix-2026-07-13.md — root is the same as 4fb7d87d, fix is trivial (import shared gitEnv).)
- Ratify: no PR Decisions block — the completion is a pure findings/observation drop (task file moved to done, no code change). The 'discharged, verify + record' branch of the task's Prompt step 4 authorizes this; flagging so the human explicitly ratifies the no-code-change outcome.
  (Commit 6dc34df0 touches only work/notes/findings + work/notes/observations + moves the task file to done. Discharging artifact cited: 4fb7d87d (gc.auto off in shared gitEnv).)
