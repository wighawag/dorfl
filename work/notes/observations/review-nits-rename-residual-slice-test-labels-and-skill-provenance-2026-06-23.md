---
title: review-gate non-blocking nits for 'rename-residual-slice-test-labels-and-skill-provenance' (Gate 2 approve)
date: 2026-06-23
status: open
reviewOf: rename-residual-slice-test-labels-and-skill-provenance
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'rename-residual-slice-test-labels-and-skill-provenance' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- In test/close-job.test.ts the task scoped only the FIRST it-block (~L115-140), which the agent correctly renamed to brief/task vocabulary (`my-brief`, "closes the brief's issue when ALL its tasks are in work/tasks/done/"). But the enclosing describe still reads `runCloseJob — the PRD case (consumes the "PRD complete?" query)` (L114) and every SIBLING it-block below (L140 `leaves the PRD issue OPEN when a prd:<slug> slice is NOT yet...`, plus the fixtures at L141-143, L159-160, L210-211, L233) still uses `my-prd` / `prd:<slug> slice` / "PRD" vocabulary. The result is one it-block in the describe reading new vocabulary while its neighbours read the old. This is within the task's LITERAL line-scoping (it named only ~L115-140) and the residual is pre-existing, so it is not a defect this task owns — but a human may want to ratify leaving the partial-rename wart, or fold the rest of this describe into a follow-up so the block reads coherently.
  (test/close-job.test.ts:114 (describe 'the PRD case'), :140-143 (2nd it-block still `my-prd`/`prd:<slug> slice`) vs :115 (1st it-block renamed to `my-brief`/tasks))
- In test/scan.test.ts the agent updated the JSDoc lines it was told to (L391 `taskable-brief pool`/`briefs[]`, L394 `task legs`) but the SAME comment block at L396 still cites "REUSES `sliceablePrds` (the SAME `autoslice-gate` predicate...)". The live src symbol was renamed to `taskableBriefs` (packages/agent-runner/src/select-priority.ts:111; scan.ts now imports/calls `taskableBriefs`), so the comment now cites a symbol name that no longer exists in src — a stale claim-vs-reality reference. It is in a comment (not code), it was OUTSIDE the task's named lines, and identical `sliceablePrds`/`autoslice-gate` citations still live in select-priority.test.ts:54, mirror-pool-scan.test.ts, and do-autopick.test.ts:294, so this is clearly a broader residual cluster, not this task's miss. Flagging so the human can ratify deferring the `sliceablePrds`->`taskableBriefs` comment/describe sweep (likely belongs with the modules-rename slice or a follow-up), not so this slice re-scopes.
  (test/scan.test.ts:396 comment `REUSES \`sliceablePrds\`` vs live symbol `taskableBriefs` at src/select-priority.ts:111)
- The PR/commit description carries no `## Decisions` block. None is strictly required here because this is a pure mechanical rename with no in-scope non-obvious design choice (no new error/refusal, no cross-task behaviour change, no user-visible default; no src/ touched). The only judgement the agent exercised was honouring the task's precise line-scoping (which produced the two coherence residuals above), and that is captured by those findings. Noting the absence only so the human is aware nothing was hidden — there is nothing to ratify beyond the scoping calls already flagged.
  (git log -1 HEAD has an empty body; git show --stat shows only test/*, skills/drive-tasks/SKILL.md, and the task-file move.)
