---
title: review-gate non-blocking nits for 'reconcile-ledger-lock-spec-adr-stuck-retirement' (Gate 2 approve)
date: 2026-07-14
status: open
reviewOf: reconcile-ledger-lock-spec-adr-stuck-retirement
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'reconcile-ledger-lock-spec-adr-stuck-retirement' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: agent chose AMEND-IN-PLACE (not supersede) for the ledger-lock ADR. Rationale is recorded in the addendum ('Amend-vs-supersede' section) rather than in a done-record '## Decisions' block. OK to keep in the ADR body?
  (docs/adr/ledger-status-on-per-item-lock-refs.md addendum bottom: 'AMENDED in place ... the ADR stays proposed; the retirement is a scoped amend'. Task prompt asked to RECORD amend-vs-supersede per ADR-FORMAT.)
- Ratify scope-widening: task named the ledger-lock ADR, its spec, and CONTEXT.md, but the agent ALSO reconciled skills/setup/protocol/{CLAIM,REVIEW,WORK-CONTRACT}.md (mirrored into work/protocol/) and docs/adr/needs-attention-folder-cutover-followup-nits.md. The prompt authorises protocol-doc updates 'if any mentions the stuck lock state', and those docs did — but flag for ratification as an in-scope decision not enumerated in the acceptance list.
  (git show --stat HEAD lists 6 extra files beyond the three named targets; diff -r skills/setup/protocol work/protocol is clean apart from VERSION.)
- Coherence nit: the WORK-CONTRACT resolve/return paragraph now says gc --ledger reports 'stuck-lock' but parenthesises 'stuck here means crash-orphan, not the retired lock state'. Given the new CONTEXT.md pins two meanings of 'stuck' (retired lock state vs SidecarKind), reusing 'stuck' as an informal label for a crash-orphan lock adds a THIRD shade. Consider renaming the report to 'orphan-lock' in a follow-up.
  (skills/setup/protocol/WORK-CONTRACT.md needs-attention resolve/return bullet.)
