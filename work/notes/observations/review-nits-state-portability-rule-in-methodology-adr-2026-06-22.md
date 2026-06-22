---
title: review-gate non-blocking nits for 'state-portability-rule-in-methodology-adr' (Gate 2 approve)
date: 2026-06-22
status: open
reviewOf: state-portability-rule-in-methodology-adr
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'state-portability-rule-in-methodology-adr' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The slice asked to 'cross-link' the three new protocol docs 'one-line each'. The ADR mentions them as backticked filenames (`REVIEW-PROTOCOL.md`, `SURFACE-PROTOCOL.md`, `SLICING-PROTOCOL.md`) inside a sentence rather than as actual markdown links or as discrete one-line bullets. This matches the existing style in §6 (which references `CLAIM-PROTOCOL.md`/`WORK-CONTRACT.md` the same way) so it is consistent, but a reader following §6 has to know to look under `work/protocol/` rather than being able to click through. Worth ratifying as 'cross-link = inline backtick mention, no relative-path link' since that is the precedent the ADR now sets for future discipline docs.
  (docs/adr/methodology-and-skills.md §6 refinement bullet: '...judgement-before-landing (`REVIEW-PROTOCOL.md`), question-surfacing (`SURFACE-PROTOCOL.md`), and slicing (`SLICING-PROTOCOL.md`).')
- In-scope decision worth ratifying: the new bullet asserts a concrete propagation chain for discipline docs — 'source of truth in `skills/setup/protocol/`, mirrored byte-identical into this repo's `work/protocol/`, vendored into the package's `dist/protocol/`, and copied into every target repo by `setup`'. The slice brief only required stating the rule and noting where the three docs live; it did not ask the ADR to nail down the full four-location propagation chain. The chain is factually correct (verified: all four paths exist with the three files), and it is consistent with AGENTS.md's source-of-truth guidance, so this is a useful clarification — but it elevates a current mechanism to ADR-level normativity, which the human may want to confirm is intended.
  (docs/adr/methodology-and-skills.md, refinement bullet, parenthetical 'The three discipline docs each live at `work/protocol/<DISCIPLINE>-PROTOCOL.md` (source of truth in `skills/setup/protocol/`, mirrored byte-identical into this repo's `work/protocol/`, vendored into the package's `dist/protocol/`, and copied into every target repo by `setup`).')
