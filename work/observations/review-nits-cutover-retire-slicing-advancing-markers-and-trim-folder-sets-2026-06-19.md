---
title: review-gate non-blocking nits for 'cutover-retire-slicing-advancing-markers-and-trim-folder-sets' (Gate 2 approve)
date: 2026-06-19
status: open
reviewOf: cutover-retire-slicing-advancing-markers-and-trim-folder-sets
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'cutover-retire-slicing-advancing-markers-and-trim-folder-sets' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- RATIFY: the user-facing CLI verb `release-advancing <item>` was fully REMOVED (not just retargeted). Is removing the verb outright the intended UX, versus keeping it as a thin alias/deprecation shim that forwards to `release-lock`?
  (cli.ts: the entire `program.command('release-advancing <item>')` definition and its `ReleaseAdvancingFlags` are deleted, replaced by a NOTE comment. The slice told the agent to 'retarget any remaining slicing/advancing reader (... cli.ts)', which is reasonably read as 'remove the now-meaningless verb', and `release-lock` genuinely subsumes it (an advance hold is now `action: advance` on the unified ref; release-lock accepts slice:/prd:/obs:). So this is functionally complete and the right design, but it is a user-visible removal of a documented command — an in-scope decision the agent made on its own that should be ratified (and noted as a potential breaking change for any script/runbook that called `release-advancing`). The agent did NOT record it in a ## Decisions block.)
- Dead code left behind: the `surfaceLedgerMove`/`publishSurfaceCommit`/`readLedgerPlacement` machinery in ledger-write.ts now has NO production caller (the live needs-attention path goes through `bounceToStuckLock` → `markStuckItemLock`), and its `WORK_FOLDERS` was reduced to `['backlog','done']` — omitting `dropped` and still containing a now-dead `folder === 'needs-attention'` message branch in readLedgerPlacement. Should this whole dead surface-commit path be deleted (here or explicitly deferred to 9d), and is the `dropped` omission acceptable given the criterion said keep the durable set `backlog`/`done`/`dropped`?
  (ledger-write.ts:882 `const WORK_FOLDERS = ['backlog','done']` with a comment 'Kept for the (now-dead) surface-commit probe below.' `publishSurfaceCommit` (line 929) and `readLedgerPlacement` (line 1087) are only referenced by comments and an unused `surface?:` type field; grep shows no caller. Because the function is dead, the missing `dropped` and the dead `needs-attention` branch have zero runtime impact, so this is cleanliness, not a defect — but a human reviewer would flag the divergence from the criterion's literal durable set and the carried-over dead code. The comment is honest about it, which is why this is non-blocking rather than a coherence block.)
