---
title: 'review-gate non-blocking nits for ''bounce-atomic-cutover-retire-stuck-lock'' (Gate 2 approve)'
date: 2026-07-13
status: open
reviewOf: bounce-atomic-cutover-retire-stuck-lock
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'bounce-atomic-cutover-retire-stuck-lock' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify D-A: the crash-window orphan reuses the existing 'cleared-stale' outcome (previously meaning 'terminal on main') rather than a new 'cleared-crash-orphan' value. The message and terminalOnMain=false distinguish them, and isReapableTerminalOrphan(cleared-stale)===true is unchanged, so 'gc --ledger' will now reap crash-window orphans through the same path — desired behaviour per the recovery predicate, but it does widen what 'cleared-stale' means. Confirm the label re-use is acceptable or ask for renaming before PR-2b consumers land.
  (packages/dorfl/src/item-lock.ts reconcile/classify + work/notes/observations/pr-2a-bounce-mechanism-decisions-2026-07-13.md D-A.)
- Ratify D-D: surfaceStuckToNeedsAttention.itemPath is silently loosened from required to optional, and a body-absent probe now returns bodyAbsent:true + released:true (a NEW result shape / new refusal-ish path). PR-1 callers still work, but any external consumer that switch-exhausted on the result shape sees a new arm. Confirm the widened contract is intended before PR-2b callers rely on it.
  (packages/dorfl/src/needs-attention.ts SurfaceStuckToNeedsAttentionOptions.itemPath now optional; SurfaceStuckToNeedsAttentionResult.bodyAbsent added.)
- Ratify D-E: the D1 probe-order table is duplicated inline inside item-lock.ts (isItemSurfacedOnMain) to avoid a cyclic import with needs-attention.ts, instead of extracting a small shared bounce-probe.ts module. Two sites must stay in sync forever; PR-2b or later extensions of the folder list must edit both. Acceptable now, or extract the shared module?
  (packages/dorfl/src/item-lock.ts isItemSurfacedOnMain candidates list vs packages/dorfl/src/needs-attention.ts BOUNCE_BODY_PROBE_ORDER.)
