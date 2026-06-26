---
title: review-gate non-blocking nits for 'protocol-land-time-reverify-invariant' (Gate 2 approve)
date: 2026-06-26
status: open
reviewOf: protocol-land-time-reverify-invariant
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'protocol-land-time-reverify-invariant' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: only `work/protocol/VERSION` was bumped (its `source-commit` line updated to `land-time-reverify-invariant-and-human-reconcile-warning`); `skills/setup/protocol/VERSION` was NOT touched. The task literally said 'Bump skills/setup/protocol/VERSION and mirror', but no VERSION file exists in the source tree — it is a sync-stamp written into mirrors by setup (see skills/setup/SKILL.md line 113). The agent's interpretation (mirror-only bump) matches the actual repo convention; just confirm this is the intended convention and the task wording is the thing that's slightly off, not the implementation.
  (git diff HEAD~1 shows VERSION change only under work/protocol/; `ls skills/setup/protocol/` has no VERSION file; setup SKILL describes VERSION as a file setup writes into the mirror.)
- Ratify placement: the human-reconcile WARNING was appended as a nested blockquote paragraph INSIDE the pre-existing 'Consequence the human must accept' blockquote (rather than as a sibling paragraph next to it). Reads cleanly and the existing `pull --rebase` mention is in that same blockquote, so placement is defensible — just confirm.
  (skills/setup/protocol/CLAIM-PROTOCOL.md hunk around line 22: the new `> WARNING — reconcile by REBASE…` line is prefixed `>` and sits under the existing `> Consequence…` blockquote.)
