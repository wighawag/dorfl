---
title: The deadline checkpoint saves WIP bytes but NOT resume-context, so a cross-tick continue-agent must reverse-engineer a half-done diff
type: observation
status: open
spotted: 2026-07-13
---

## What was seen

The graceful-checkpoint feature (`graceful-pre-timeout-wip-checkpoint`, #366) was validated live (run 29281922327): PR-2b `bounce-migrate-stuck-assertions-and-flip-exit-codes` hit the 15-min internal deadline, SAVED its WIP + branch, and AUTO-CONTINUED (checkpoint 1/5, green). The work-preservation half works perfectly.

But the SAVED WIP was a large PARTIAL migration: `git diff origin/main...HEAD --stat` on the checkpoint branch showed 33 files changed, +775/-191 lines — the three bounce seams re-pointed and a big chunk of the 84 `stuckLockOnArbiter` assertions migrated across ~30 test files, with the tree in an unknown (likely red) mid-migration state. The next tick's continue-agent is a FRESH pi session with NO memory of the prior session: it must reverse-engineer that diff to reconstruct "what did a previous me already do, and what's left."

## Why it matters

The checkpoint preserves BYTES, not CONTEXT. For a coherent single-shot job (a wide migration, a big refactor) resumed cold across ticks, the resume-agent can:
- burn a large fraction of the next deadline just re-orienting on the diff;
- re-run a migration script over already-migrated files (corrupting them);
- drive the half-done tree in a DIFFERENT direction than the first session started, never converging before the `maxAutoCheckpoints` ceiling.

So "the checkpoint makes over-cap work RESUMABLE across ticks" is only HALF true: the work survives, but resuming it coherently is unproven and doubtful for complex tasks. The base checkpoint task explicitly deferred a "continue-token / resumable-task protocol" as out of scope — this observation is the concrete evidence that the deferred half is real and load-bearing for genuinely-over-cap tasks.

## The fix (already scoped)

pi natively supports SESSION CONTINUATION (`--continue` / `--session <path>`, verified in `pi --help`), and the harness already records the session file (`PiHarnessRecord.session`). So the deadline handler can RESUME THE ACTUAL PAUSED SESSION (full context intact) for one bounded turn and have it write an authoritative HANDOFF NOTE (done / remaining / tree state / next step) before stopping — vastly better than a fresh agent reverse-engineering the diff, and better than a static prompt preamble. Scoped as the task `deadline-checkpoint-writes-handoff-note` (spec `graceful-pre-timeout-wip-checkpoint`).

## Interim mitigations already applied

- Bumped `agentDeadlineMinutes` 15 → 90 so a coherent single-shot task like PR-2b likely finishes in ONE session (sidestepping resume entirely).
- Added a RESUMPTION-CHECK preamble to PR-2b's `## Prompt` (assess the partial state, don't re-run wholesale) — a best-effort static aid, inferior to the session-resumed handoff note.

## Refs

- Run 29281922327 (checkpoint fired, WIP saved, auto-continued 1/5), branch `work/task-bounce-migrate-stuck-assertions-and-flip-exit-codes` with the partial migration + `chore(deadline-checkpoint): save wip` marker.
- Feature: `work/tasks/done/graceful-pre-timeout-wip-checkpoint.md` + ADR `docs/adr/graceful-pre-timeout-checkpoint-vocabulary.md`.
- Fix task: `work/tasks/backlog/deadline-checkpoint-writes-handoff-note.md`.
