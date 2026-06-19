---
title: review-gate non-blocking nits for 'cutover-needs-attention-becomes-lock-stuck-recovery-surface' (Gate 2 approve)
date: 2026-06-19
status: open
reviewOf: cutover-needs-attention-becomes-lock-stuck-recovery-surface
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'cutover-needs-attention-becomes-lock-stuck-recovery-surface' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Criterion #4 ('No code writes or reads a work/needs-attention/<slug>.md folder file') is only PARTIALLY met: the slicing decomposition-unclear bounce in slicing-lock.ts (~line 746) still git-mv's the held PRD into work/needs-attention/<slug>.md on main, and slicing.test.ts asserts onArbiter('work/needs-attention/it.md')===true. Confirm this residual folder writer is acceptable to leave for 9c, given the slice body's 'retire the needs-attention/ folder move END-TO-END' wording reads as absolute.
  (slicing-lock.ts handles the action:slice abort bounce; 9c (cutover-retire-slicing-advancing-markers-and-trim-folder-sets) explicitly owns 'remove slicing's git mv prd->slicing marker + abort bounce'. So this is a deliberate in-scope boundary, not drift - but 9b's criterion #4/#What-to-build wording is absolute, so a human should ratify that the slicing path is out of 9b's scope rather than an incomplete cutover.)
- In-scope decision to RATIFY: several needs-attention surfaces were retained as dead/vestigial rather than deleted - readNeedsAttentionItems() now always returns [] (and is index-exported + tested-as-empty), resolveFromNeedsAttention() and surfaceToNeedsAttention() are callerless, and status.ts keeps the RepoNeedsAttention type + needsAttention field always set to []. Confirm leaving these for a later cleanup/9c is intended (vs deleting them now).
  (needs-attention.ts:1593 (resolveFromNeedsAttention), :1130 (surfaceToNeedsAttention), :1630 (readNeedsAttentionItems); status.ts:87/131/284. Keeping a retired reader returning empty is reasonable (the folder-set trim is 9c's job), but it is dead surface area a human may want explicitly tracked.)
- In-scope decision to RATIFY: a bounce with no held lock (markStuckItemLock outcome 'not-held') now returns moved:false ('the bounce could not record the stuck state'), whereas the old folder bounce always 'succeeded'. For an item that predates the lock or a flow that did not claim, integration-core/do/run will now report 'not routed to needs-attention'. Confirm honest-fail-when-no-lock is the desired behaviour.
  (ledger-write.ts bounceToStuckLock() docblock + 'not-held' branch. The reasoning is sound (with the folder retired there is no other substrate to record stuck on, so faking success would hide the loss), and autonomous do/run always hold the implement lock first - but it is a user-visible behaviour change worth a human's nod.)
- The PR/commit carried no '## Decisions' block although the slice is design-heavy and explicitly instructs 'Record non-obvious in-scope decisions per the slice template'. The three decisions above (slicing-folder deferral, dead-surface retention, not-held semantics) were left for the reviewer to surface. Worth noting for process.
  (git log -1 body has only the subject line; no Decisions section. Not a code defect; flagged so the human can backfill the rationale if they want it captured.)
