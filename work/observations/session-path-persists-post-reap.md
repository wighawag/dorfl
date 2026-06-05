---
title: pi sessions now persist post-reap (consequence of session-path-pi-default); slug helper replicated, not imported
type: observation
status: spotted
spotted: 2026-06-05
---

# Consequences recorded while building `session-path-pi-default`

Two conscious notes the slice asked to record (acceptance criteria), captured
here since the in-progress slice file is runner-owned and must not be edited by
the building agent.

## 1. Sessions persist after a worktree is reaped (DESIRED, no `gc.ts` change)

The pi adapter now writes its session `.jsonl` under the resolved `sessionsDir`
(default: pi's per-cwd dir under `~/.pi/agent/sessions/`), NOT inside the job
worktree. Verified `src/gc.ts` (`reapJob`/`evaluateDeletionSafety`) references NO
session path — it only checks (a) a clean worktree and (b) arbiter-reachability —
so no code change was needed there. The behaviour change is purely a consequence:
runner-driven sessions now SURVIVE a worktree reap (the audit trail of a
failed/needs-attention job is no longer destroyed with the worktree). pi's own
session retention governs their cleanup, not agent-runner. This is an improvement
(post-mortem survives), recorded consciously per the slice.

## 2. Build-time decision: REPLICATE the slug helper, do NOT import pi

pi exports `getDefaultSessionDir(cwd)`, but agent-runner does NOT depend on
`@earendil-works/pi-coding-agent` (only `commander` is a runtime dep — see
`slice-premise-pi-coding-agent-not-a-dep.md`). Adding the dep solely to derive
the per-cwd slug would pull a heavy tree, so the tiny, stable slug encoding
(`--${cwd without leading slash, separators/colon → '-'}--`) was REPLICATED in
`src/session-path.ts` (`piDefaultSessionsDir`), mirroring the do-watch slice's
local-structural-type choice. The pure path is computed (no `mkdirSync` side
effect like pi's `getDefaultSessionDir`); pi's `SessionManager.open` mkdirs the
session file's parent on open, and the `--watch` tailer tolerates a
not-yet-existent file (ENOENT → retry), so no eager dir creation is needed.

Delete this observation once both notes are no longer useful (the persistence
behaviour is now the documented norm).
