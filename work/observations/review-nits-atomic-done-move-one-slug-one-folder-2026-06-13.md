---
title: review-gate non-blocking nits for 'atomic-done-move-one-slug-one-folder' (Gate 2 approve)
date: 2026-06-13
status: open
slug: atomic-done-move-one-slug-one-folder
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'atomic-done-move-one-slug-one-folder' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Should do.ts map a `complete` `invariant-violation` outcome to its own needs-attention terminal instead of falling through to `usage-error`?
  (do.ts:883-885 (in-place) and 1762-1764 (--remote) list only gate-failed/review-blocked/rebase-conflict in the needs-attention arm; `invariant-violation` falls through to the final `outcome = ... 'usage-error'` line. This is SAFE (exit 1, message surfaced verbatim, never exit-0/completed) and `do` is supervised, so it is not the false-success defect this requeue fixed and is out of scope. But it classifies a deliberate ledger-corruption refusal as a generic usage-error, asymmetric with the dedicated handling run.ts and complete.ts now give it. A human may want to align do.ts in a follow-up for cross-caller consistency.)
