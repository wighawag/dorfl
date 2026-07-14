---
title: review-gate non-blocking nits for 'retire-stuck-lock-state' (Gate 2 approve)
date: 2026-07-14
status: open
reviewOf: retire-stuck-lock-state
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'retire-stuck-lock-state' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify D1–D7 as recorded in work/notes/observations/retire-stuck-lock-state-decisions-2026-07-14.md (LockState collapses to a single-value union with legacy coercion; reason/questions fields deleted from LockEntry; resumeItemLock repurposed for crash-window orphan convergence; requeueItemLock drops its wrong-state guard; markStuckItemLock kept as no-op shim; ReconcileOutcome/ReapOutcome collapse removing kept-stuck/cleared-stuck-terminal/reaped-stuck-terminal — a public gc --ledger JSON change; startFromNeedsAttention preserved as legacy no-op).
  (decisions doc D1–D7; note D5 keeps a shim to avoid rewriting ~30 test call sites and D6 is a visible JSON contract change on gc --ledger.)
- Stale JSDoc: src/start.ts dispatchFolder header still describes the retired 'held stuck ⇒ needs-attention' recovery dispatch (lines ~229–243), and the file still references 'marked stuck on its per-item lock' (~408, ~442) and 'stuck needs-attention item' (~34, 47, 57, 454–455, 469); the code below correctly no longer implements it. Worth a follow-up doc sweep so the language matches the retired-state reality.
  (grep of 'stuck' in src/start.ts vs the actual post-retire dispatch logic that only checks lock.state==='active'.)
- Minor doc drift: resumeItemLock JSDoc says the healthy-active-hold path returns 'wrong-state' but the implementation returns 'not-held' (matching D3, which explicitly says wrong-state is retired). Align the JSDoc with the code.
  (packages/dorfl/src/item-lock.ts around line 771 vs the return at ~815.)
