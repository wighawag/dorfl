---
title: review-gate non-blocking nits for 'bounce-surfaces-stuck-sidecar-and-releases-lock' (Gate 2 approve)
date: 2026-07-13
status: open
reviewOf: bounce-surfaces-stuck-sidecar-and-releases-lock
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'bounce-surfaces-stuck-sidecar-and-releases-lock' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: on every bounce, the primitive appends an engine-authored envelope entry ('<item>' was bounced — how should we proceed?, context=reason, kind=stuck) BEFORE any agent-surfaced questions, and does so even on repeat surfaces (envelopes pile up). Is that pile-up on repeated bounces the intended shape, or should the second-and-later envelope collapse?
  (packages/dorfl/src/needs-attention.ts ~L1490–L1508 (DECISION docblock + entry composition); test 'appends (never overwrites)' asserts 3 entries after two bounces (envelope1, envelope2, one agent Q).)
- Ratify the canned envelope wording and the default kind coercion: caller-supplied questions with kind===undefined are silently stamped 'stuck' (q.kind ?? 'stuck'). If a caller ever legitimately wants a non-stuck kind here they must pass it explicitly — is that the right default for the tree-less surface path?
  (needs-attention.ts L1499–L1504: envelope kind:'stuck', surfaced=(questions??[]).map(q=>({...q,kind:q.kind??'stuck'})).)
- Ratify: the harness routes the surface through runTreelessLedgerMove with kind:'needs-attention', so a ledger row of that kind is written even though nothing MOVES (only sidecar+body flag). Once PR-2 flips seams, will this row coexist cleanly with the seam's own needs-attention ledger row, or could it double-count?
  (needs-attention.ts L1625–L1629 (surfaceStuckToNeedsAttention → runTreelessLedgerMove {kind:'needs-attention'}); ledger-write.ts LedgerTransitionKind includes 'needs-attention'.)
- Ratify the new throwaway ref namespace refs/dorfl/surface-stuck/<slug>. It parallels the existing needs-attention/requeue namespaces and should not collide, but it is a new user-visible namespace worth acknowledging.
  (needs-attention.ts L1642 refNamespace:'surface-stuck'.)
- The task prompt asked to RECORD non-obvious in-scope decisions durably and linked from the done record. The DECISION block lives in the code doc (which is durable) but the done-record task file itself was moved unchanged and has no Decisions section pointing to it. Add a link for future spelunkers?
  (work/tasks/done/bounce-surfaces-stuck-sidecar-and-releases-lock.md is byte-identical to the ready version; commit body is title-only.)
