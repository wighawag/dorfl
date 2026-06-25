---
title: review-gate non-blocking nits for 'review-nits-work-contract-sanction-deletion-on-apply-discharge-2026-06-24' (Gate 2 approve)
date: 2026-06-25
status: open
reviewOf: review-nits-work-contract-sanction-deletion-on-apply-discharge-2026-06-24
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'review-nits-work-contract-sanction-deletion-on-apply-discharge-2026-06-24' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: the agent treated nit #1 (drop the 'duplicate' pseudo-disposition pairing) as STALE — current L70 no longer contains the dropped/duplicate pairing the task described, so only nit #3 (anchor the self-quoted clause) was actually edited. The task framing ('Two nits to fix, one to verify') did not foresee this; the prompt did invite 'read current reality' which authorises it. Worth a Decisions-block entry; no code change needed.
  (Task says nits 1 + 3 to fix, 2 to verify. grep shows 'duplicate' only at L31/L67 as a REASON, not at L70. Commit message has no Decisions block recording the reassessment.)
- Ratify minor editorial expansion: the new anchor adds an inline gloss ('a judgement only a human is authorised to make') that is not literally quoted from L72, going slightly beyond pure anchoring. Intent-preserving but a small authored addition the task did not ask for.
  (skills/setup/protocol/WORK-CONTRACT.md L70 new text: 'the capture-bucket rule below — a note "leaves the inbox by deletion the moment it stops being a live signal", a judgement only a human is authorised to make'. L72 wording does not contain the 'judgement only a human is authorised' clause.)
