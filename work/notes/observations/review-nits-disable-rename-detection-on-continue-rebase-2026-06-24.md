---
title: review-gate non-blocking nits for 'disable-rename-detection-on-continue-rebase' (Gate 2 approve)
date: 2026-06-24
status: open
reviewOf: disable-rename-detection-on-continue-rebase
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'disable-rename-detection-on-continue-rebase' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: agent picked `-Xno-renames` (rebase merge-strategy option, repeated literally on each invocation) over the equivalent `-c merge.renames=false` front-config — and applied it to EXACTLY the three forward rebase invocations on the continue/integration path (`continue-branch.ts` line 200; `integration-core.ts` lines 1041 and 1599). Is this the choice we want, or should a single shared constant (e.g. `RENAME_OFF_REBASE_ARGS`) be exported so a future fourth rebase doesn't silently drift?
  (Two `-Xno-renames` string literals in `integration-core.ts` plus one in `continue-branch.ts`. Both alternatives (`-Xno-renames` vs `-c merge.renames=false`) were called out as legitimate in the task; the agent went with the former without making the choice DRY. Stale-lease retry coverage is fine because the continue-branch retry loop re-invokes `rebaseContinuedBranchOntoMain` and the integration Race-1 retry re-invokes the enclosing `replayCleanlyOntoMain` — both pass through the patched lines.)
- Ratify / record: there is no explicit `## Decisions` block in the PR description (commit message body is empty) and no separate done-record file. The maintainer's `-Xno-renames`-over-sentinel decision (2026-06-20) was flagged in the task as a STRONG ADR candidate; the agent captured the rationale in extensive in-source comments but did NOT promote it to `docs/adr/`. Promote to ADR, or accept the comment-block as the durable record?
  (Task AC: 'The sentinel (README/.gitkeep) alternative is explicitly NOT adopted; the task/done record states WHY.' The WHY is present in `continue-branch.ts` lines 178-198 and matches the maintainer's stated rationale, so the AC is technically met — but a future reader hitting `docs/adr/` won't find it there. Existing ADRs in `docs/adr/` cover comparable-weight policy calls (e.g. `placement-is-runner-deterministic-humanonly-is-agent-judgement.md`).)
