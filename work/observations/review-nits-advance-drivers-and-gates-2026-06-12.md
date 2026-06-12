---
title: review-gate non-blocking nits for 'advance-drivers-and-gates' (Gate 2 approve)
date: 2026-06-12
status: open
slug: advance-drivers-and-gates
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'advance-drivers-and-gates' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: `run --advance <mirror>` orchestrates every pool item's `do`/`do prd:` IN-PLACE in the daemon's single cwd checkout (buildAdvanceRunTick uses process.cwd() for all items, and keyFor:()=>mirrorPath makes perRepoMax cap the whole batch), explicitly deferring the cross-repo mirror→worktree substrate to run-daemon-reframe. Is landing the loop driver ahead of that substrate intended, accepting that real concurrent in-place builds in one checkout would collide and so 'genuine parallelism' (AC #1) is effectively bounded/deferred for now?
  (cli.ts buildAdvanceRunTick: cwd = process.cwd(); doOptions.cwd = cwd; the comment names run-daemon-reframe as the separate work. advance-loop-driver.ts advanceOnce: keyFor: () => options.mirrorPath, so perRepoMax bounds the entire batch. The integration test stubs the per-item AdvanceTickRunner, so concurrent in-place builds are never exercised. PRD §258 frames run-daemon-reframe as 'ideally' the substrate for the looped driver — consistent with this deferral, but worth an explicit human OK.)
- Ratify the status overload: an idle `no-op` advance tick (a pending sidecar awaiting a human) is projected onto run's ItemStatus 'lost-race' (skipped). ItemStatus documents 'lost-race' as 'claim exit 2 — skipped cleanly', so when the advance tick drives runLoop, 'lost-race' now means two things (a CAS loser AND a calm-at-rest idle). Acceptable as a localized adapter projection, or should the run reporting carry a distinct 'idle/no-op' bucket?
  (advance-loop-driver.ts advanceOutcomeToItemStatus: no-op→'lost-race'; batchToRunOnceResult counts lost-race+claim-contended as `skipped`. The loop only consumes the aggregate counters, and 'skipped, do not retry' is the right bucket for calm-at-rest — but the term is reused with a second meaning at this seam.)
- Ratify the new user-visible surface: `run --advance <mirror>` as the flag that swaps the looped tick from BUILD to ADVANCE (default unset ⇒ the build tick, unchanged). Is `run --advance <mirror>` the right shape/name for selecting the advance loop, vs e.g. a subcommand or an `advance --loop`?
  (cli.ts adds RunFlags.advance and the --advance option; `run --once` also debug-ticks the advance tick via `(advanceTick ?? runOnce)`. New user-facing flag + default behaviour, not specified verbatim by the slice — the slice said the loop driver IS `run`, leaving the exact CLI shape to the agent.)
- The branch carries no `## Decisions` block and its sole commit is 'save aborted work (wip)', despite the requeue explicitly asking for a real commit message + a Decisions block. Confirm the work is intended as finished (the loop wiring + its convergence test are the completing work, the WIP commit is stale), and capture the three decisions above into the PR description before merge.
  (git log main..HEAD = one commit 'chore(advance-drivers-and-gates): save aborted work (wip)'; the loop wiring is in the uncommitted working tree that Gate-1 ran green over. The runner owns the commit transition, but the absent Decisions block is the agent's own deliverable and is what left these in-scope choices unratified.)
