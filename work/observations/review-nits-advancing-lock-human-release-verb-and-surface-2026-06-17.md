---
title: review-gate non-blocking nits for 'advancing-lock-human-release-verb-and-surface' (Gate 2 approve)
date: 2026-06-17
status: open
slug: advancing-lock-human-release-verb-and-surface
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'advancing-lock-human-release-verb-and-surface' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the verb-name choice (standalone `agent-runner release-advancing <item>` rather than `gc --advancing <slug>`), and record the rationale + the no-auto-sweep + centralized-helper coordination in a Decisions block.
  (The slice's DONE bullet explicitly required `## Decisions` to capture the verb-name choice, the no-auto-sweep rationale, and the cross-PRD centralized-helper coordination with the folder-taxonomy PRD. The agent shipped `release-advancing` (a defensible pick that parallels `requeue` and avoids forking `gc` into a non-sweep sub-flag) but did NOT update the `## Decisions (to record while building)` block in `work/done/advancing-lock-human-release-verb-and-surface.md` — it still reads as the template — and the commit message has no Decisions block either. The choice itself is fine; the missing record is the finding.)
- Ratify the cross-surface decision to make `gc --ledger` exit non-zero when ANY `work/advancing/` marker is present (previously it only exited non-zero on duplicate-folder slugs).
  (cli.ts now exits with code 1 when `result.duplicates.length > 0 || result.advancingMarkers.length > 0`. This is a reasonable fail-loud parallel with the duplicate-slug surface, but it is a behavior change to an existing CLI surface that other slices / CI may rely on for a clean signal. A live `advance` in another worktree that has legitimately just acquired its marker would now cause a parallel `gc --ledger` to exit 1 — usually fine because the report is advisory, but worth a conscious nod.)
