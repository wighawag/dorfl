---
title: review-gate non-blocking nits for 'ledger-integrity' (Gate 2 approve)
date: 2026-06-12
status: open
slug: ledger-integrity
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'ledger-integrity' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- finish-already-committed-branch carries needsAnswers:true for the operator-surface fork (complete --isolated vs a distinct verb); it will not be auto-claimable until a human answers, and its acceptance criteria presume complete --isolated/resume --isolated. Confirm that is the intended gate (it is honest and correct as written).
  (work/backlog/finish-already-committed-branch.md frontmatter needsAnswers:true + the Open questions section; this is a flagged deliberate non-delivery, not a missing story.)
- The lint/sweep slice enumerates out-of-scope/ as a status folder, but work/out-of-scope/ does not currently exist in this repo. Ensure the lint treats an absent status folder as an empty set (no crash, no false positive).
  (work/backlog/ledger-one-slug-one-folder-lint-and-sweep.md lists backlog/in-progress/needs-attention/done/out-of-scope; `ls work/out-of-scope` is absent today. out-of-scope IS a legitimate contract status folder (WORK-CONTRACT.md:23,33), so including it is correct; only the absent-folder handling is worth noting.)
