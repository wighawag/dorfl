---
title: 'review-gate non-blocking nits for ''graceful-pre-timeout-wip-checkpoint'' (Gate 2 approve)'
date: 2026-07-13
status: open
reviewOf: graceful-pre-timeout-wip-checkpoint
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'graceful-pre-timeout-wip-checkpoint' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- The anti-loop 'made progress this session' gate uses isWorkBranchDiffEmpty (branch-vs-arbiter/main), not session-vs-session-start as the spec's language suggests ('WIP commit must DIFFER from the branch tip the leg started from this session'). Combined with the fact that the auto-continue counter counts chore(deadline-checkpoint) marker commits — which are only written when hasStaged is true — a session that produced ZERO edits AFTER a prior progressing session reads as progress (the earlier marker sits ahead of main) AND does not add a new marker (so the ceiling never grows). Net: a wedge-after-progress can auto-continue past maxAutoCheckpoints. Please ratify: is branch-vs-main progress + marker-commit counter the intended design (cross-tick progress = still progressing overall), or should the check be session-scoped against the branch tip captured at leg start?
  (do.ts: countDeadlineCheckpointsOnBranch counts chore(deadline-checkpoint) subjects in arbiter/main..HEAD; saveDeadlineCheckpoint only commits the marker when hasStaged is true; routeDeadlineCheckpoint then calls isWorkBranchDiffEmpty (branch-vs-main via hasSourceCommitsAhead).)
- Ratify decision: the auto-continue counter lives on the branch as marker commits (chore(deadline-checkpoint)) rather than on the lock entry. The task offered both ('on the lock entry / branch') so this is in-scope, but the branch-based counter resets only on integration or a --reset requeue, not 'on any non-deadline outcome' as the goal section states — a non-deadline surface (real bounce) followed by a plain requeue would carry markers forward.
  (do.ts DEADLINE_CHECKPOINT_COMMIT_SUBJECT_PREFIX + countDeadlineCheckpointsOnBranch; task Goal section: 'The counter RESETS on any non-deadline outcome.')
- cli.ts declares an unused --arbiter option on the new `dorfl config` command; it is parsed into `flags.arbiter` but never read by the action (resolveRepoConfig receives no arbiter override). Either wire it through or drop the flag to keep the command honest.
  (cli.ts config command: .option('--arbiter <remote>', …) with an action that only reads flags.config/flags.json.)
- Ratify: on the surface-fallback path (auto-continue release-lock failed), routeDeadlineCheckpoint then calls applyNeedsAttentionTransition unconditionally, which double-pushes the branch and marks the lock stuck. Intended as best-effort fallback? A note in the code says so; just confirming this is the desired ledger outcome when returnToBacklog fails after a successful save.
