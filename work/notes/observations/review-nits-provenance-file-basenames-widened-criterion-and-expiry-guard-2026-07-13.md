---
title: 'review-gate non-blocking nits for ''provenance-file-basenames-widened-criterion-and-expiry-guard'' (Gate 2 approve)'
date: 2026-07-13
status: open
reviewOf: provenance-file-basenames-widened-criterion-and-expiry-guard
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'provenance-file-basenames-widened-criterion-and-expiry-guard' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the criterion-audit outcome: the agent SURFACED (did not remove) four rename-cutover/refactor-lesson entries and one pre-backlog rename entry as borderline in the JSDoc audit note, per the task's 'surface, do not silently remove' instruction. Confirm this is the desired disposition or schedule follow-up cleanup.
  (`packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` around the CRITERION-AUDIT NOTE (2026-07-13))
- PR description / commit body is empty — no Decisions block. The task made two in-scope decisions worth recording: (1) the surfaced-borderline entries above, (2) narrowing the guard's walk to work/** only (matches task text, but is a visible scope choice vs. the scanner's broader tree).
  (git log -1 shows only the auto-generated subject line; no Decisions section)
- The guard claims 'same lens as the main scan' but re-implements a SIMPLIFIED subset of isAllowedWordHit: it does not honour the terminal-history `prd:` allowance nor the published-namespace `prd-<...>` / `pre-prd/` / `work/prd/` carve-outs. Direction is conservative (guard counts MORE hits, so stays quiet longer — safe), but the comment overstates parity. Consider calling isAllowedWordHit directly with terminalHistory=isTerminalHistory(rel) so the two lenses cannot drift.
  (guard body vs isAllowedWordHit at ~line 397)
