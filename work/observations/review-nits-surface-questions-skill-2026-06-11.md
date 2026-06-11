---
title: review-gate non-blocking nits for 'surface-questions-skill' (Gate 2 approve)
date: 2026-06-11
status: open
slug: surface-questions-skill
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'surface-questions-skill' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the skill resolves PRD US #34's stale wording ("persist via `do advance`") to "persist via the `advance` verb — NOT `do advance`", on the grounds that `advance` is a sibling top-level verb and `do` subcommands are REJECTED elsewhere in the same PRD (US #5, command-surface section). Confirm this is the intended command grammar and consider correcting US #34 in the PRD so the next reader doesn't re-introduce `do advance`.
  (PRD `work/prd-sliced/advance-loop.md` line 97 (US #34) says "persist via `do advance`", which contradicts US #5 (line 68) and the command-surface block (line 44), both of which mandate `advance` as a sibling verb and reject `do` subcommands. The slice (`surface-questions-skill.md` lines 21/32/44) and the landed skill both correctly use the corrected `advance`-verb wording. This is the coherent choice; the finding is to ratify it and optionally fix the PRD typo at source.)
- Ratify (in-scope decision the agent made, not spelled out in the slice): the skill specifies the EXACT no-judgement emptiness conditions for an empty question set — review approves with no blocking findings, the observation has "an obvious conservative disposition the PRD's auto-triage bar covers", and nothing pre-existing — and instructs emitting an explicit empty set rather than manufacturing a question. This couples the surface rung's emptiness bar to the `autoTriage` auto-disposition bar (US #17). Confirm that linkage is intended.
  (Skill section "Your output": "If the item carries no open judgement (review approves with no blocking findings, the observation has an obvious conservative disposition the PRD's auto-triage bar covers, nothing pre-existing) — emit an empty question set." The slice's acceptance criteria do not enumerate the empty-set conditions; the agent derived them from the PRD's option-c auto-triage bar (US #17). It is a sensible, conservative default, but it is a cross-rung interaction (surface-emptiness ↔ autoTriage gate) worth a human nod since the actual auto-triage gating lands in a later engine slice.)
- Ratify (in-scope decision): the skill asserts the observation-triage rung must "investigate the observation's claim against current reality (code / slices / PRDs / ADRs) so the inline context and the suggested default are honest" — i.e. it imports `triage-observations`' investigate-before-judging discipline into surface-questions for the observation case. Confirm this is the intended division (surface-questions does the investigation that backs the triage question's context/default) rather than deferring all investigation to a separate triage rung.
  (Skill "What you COMPOSE" item 2 carries over `batch-qa`'s native triage judgement and explicitly requires investigating against current reality. The slice says to compose "the native observation-triage question (promote/keep/delete)" but does not spell out that surface-questions itself performs the reality-investigation. This is a reasonable reading (an honest default needs honest context), and it does not duplicate `to-slices`/`review`, but it is a non-obvious scope choice about where the investigation work lives, worth ratifying.)
