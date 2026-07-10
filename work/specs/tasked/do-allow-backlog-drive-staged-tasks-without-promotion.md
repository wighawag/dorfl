---
title: do --allow-backlog — drive staged tasks in place without promoting (staging is the human-control position)
slug: do-allow-backlog-drive-staged-tasks-without-promotion
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked — they move into tasks/ADRs and this prd settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

A human (or a human-driven `drive-tasks` conductor) who wants to BUILD a specific
set of staged tasks must first promote them `tasks/backlog/ → tasks/ready/`. But
`tasks/ready/` is the AGENT POOL: the moment a task lands there on the arbiter, a
CI `advance` leg OR a machine-local `run` daemon can claim it (both pull from
`tasks-ready` — `run.ts:929` hardcodes `source: 'tasks-ready'`). So
promote-then-drive opens a COMPETITION WINDOW: the autonomous claimer races the
human who wanted to drive the work themselves.

This is the SECOND instance of one recurring shape (the first was PRD tasking:
promoting `specs/proposed → ready` exposed a PRD to the auto-tasker, fixed by
tasking in place from `proposed/` — see TASKING-PROTOCOL.md §6 and the PRD
`observation-discharge-...`). The general principle the contract states only
implicitly: **a staging folder is not just "review-first admission"; it is also
the HUMAN-CONTROL position — an item rests there so a human can drive it WITHOUT
an autonomous claimer competing, because promotion to the pool is EXACTLY what
makes it claimable-by-anyone.** The safe path (drive in place) currently requires
discipline; the unsafe path (promote-then-drive) is the obvious one.

Worse, the mechanism to drive in place DOES NOT EXIST yet: `drive-tasks`'s
"Opt-in: drive tasks from `tasks/backlog/`" mode dispatches `dorfl do
task:<slug> --isolated`, but `do`'s `resolveTask` (`prompt.ts:567`) only searches
`['in-progress', 'tasks-ready']`. So that documented mode, if run today, throws
`no task '<slug>' found in tasks/ready/`. The skill specifies a mode the CLI
cannot honour.

## Solution

From the operator's perspective: I can point `do` (or human-driven `drive-tasks`)
at a task that is still in `tasks/backlog/` and build it IN PLACE, with an
explicit `--allow-backlog` flag — without ever promoting it to the pool. Because
the staged task is never in `tasks/ready/`, no CI leg or `run` daemon can claim
it: I keep sole control of the set I am driving until I decide (if ever) to
promote. The flag is the mechanism that finally makes `drive-tasks`'s opt-in
backlog mode actually work.

## User Stories

1. As an operator, I want `dorfl do task:<slug> --allow-backlog` to resolve and
   build a task that lives in `tasks/backlog/`, so I can drive a staged task in
   place without promoting it.
2. As an operator, I want `--allow-backlog` to widen ONLY task RESOLUTION (add
   `tasks-backlog` to the search), leaving claim / lock / build / gate semantics
   identical, so driving a staged task is the same build as driving a ready one.
3. As an operator driving a staged task to completion, I want the done-move to go
   `tasks/backlog/ → tasks/done/` directly (skipping `tasks/ready/`), because my
   explicit drive IS the promotion — and I want this to be deliberate and tested,
   not incidental.
4. As a maintainer, I want `--allow-backlog` to be EXPLICIT-INVOCATION-ONLY —
   never settable by `run`'s daemon, never a config/env default, never passed by
   CI's `advance` matrix or `do`'s auto-pick — so it cannot recreate the
   competition bug one layer down (the `intake` "explicit invocation IS the
   authorization" precedent).
5. As a `drive-tasks` user invoking its opt-in backlog mode, I want the conductor
   to dispatch `do ... --allow-backlog` so the mode actually builds staged tasks
   (today it would throw), and I want the skill to state WHY drive-in-place beats
   promote-then-drive (the competition window).
6. As a contributor reading `WORK-CONTRACT.md`, I want the staging-is-also-the-
   human-control-position principle stated explicitly (generalising both the PRD
   tasking fix and this one), so the next author reaches for drive-in-place, not
   promote-then-drive.
7. As a reader of `resolveTask`, I want its stale "in-progress over backlog" /
   "NOT in backlog on the arbiter" doc comments (which pre-date the
   backlog→ready rename and now ambiguously say "backlog" where the code means
   `tasks-ready`) corrected, so "backlog" is not used for two different folders
   in the same function that now genuinely searches `tasks-backlog`.

### Autonomy notes (the two gate axes)

- **`humanOnly` (DECIDED):** OMITTED — tasking this PRD does not require a human
  to drive it; the design is fully resolved and agent-taskable. (Note: the
  FEATURE is about human-controlled building, but BUILDING the feature is
  ordinary agent work.)
- **`needsAnswers` (DISCOVERED):** OMITTED — the three code-shaped questions
  raised during design were each resolved by reading the code (the claim
  predicate → decision 2; the done-move `source` union → decision 4; the
  same-slug precedence → decision 5). The blast radius is now known and bounded,
  so the PRD is taskable.

## Resolved decisions

1. **`--allow-backlog` widens task RESOLUTION** by adding `tasks-backlog` to
   `resolveTask`'s search `order` (LOWEST priority, after `tasks-ready`) when the
   flag is set; thread the flag `do` CLI → `do` options → the two `resolveTask`
   call sites (`do.ts:969`, `:2121`). The build agent, acceptance gate, and
   Gate-2 are unchanged.

2. **Claim stays a pure lock; the body stays in `tasks/backlog/` (rejected:
   promote-on-claim).** `--allow-backlog` widens the CLAIMABLE PREDICATE's folder
   check to ALSO accept a `tasks/backlog/`-resident body (today it keys on the
   pool folder, `claim-cas.ts`); the claim still ACQUIRES only the per-item lock
   and writes NOTHING to `main`, and the body STAYS in `tasks/backlog/`.
   - REJECTED ALTERNATIVE — "claim MOVES the task `backlog → ready` along with
     taking the lock": this reintroduces the `git mv` + `main` claim commit that
     the per-item-lock cutover (prd `ledger-status-per-item-lock-refs`, ADR
     `ledger-status-on-per-item-lock-refs`) DELETED on purpose — it would lose
     the "claim touches no `main`, so a protected-`main` repo can be claimed"
     property. And it buys nothing: a competitor is excluded by the HELD LOCK,
     not by the folder — the pool scan subtracts `heldTaskSlugs`
     (`claim-cas.ts` imports it) regardless of which folder the body rests in. So
     the lock already provides the exclusion that a move-to-`ready` appeared to;
     moving is both unnecessary (lock does it) and harmful (re-couples claim to
     `main`). The body's folder is durable resting STATUS, never claimed-ness.
3. **The leak-fence is structural, not just disciplinary.** `run` does NOT invoke
   `do` as a subprocess — it calls `performIntegration` directly with a hardcoded
   `source: 'tasks-ready'` (`run.ts:929`), so a `do` CLI flag physically cannot
   reach it. `do`'s auto-pick path selects from the pool and must not set the
   flag (defaults off). CI's `advance` matrix must not pass it. Net: reachable
   ONLY via an explicit human-typed (or human-driven `drive-tasks`) invocation.
4. **The done-move `source` union DOES need a `tasks-backlog` member (CONFIRMED
   by reading the code).** The completion path types `source: 'tasks-ready' |
   'in-progress' | 'needs-attention' | 'done'` (`complete.ts:716`) and the
   integration core does `git mv work/<source>/<slug>.md → work/done/`
   (`integration-core.ts:976`). A `tasks/backlog/`-resident task has NO valid
   `source` today — the ternary falls through to `'needs-attention'` and the
   `git mv` would target the wrong folder. So the change is: add `tasks-backlog`
   to the `source` union + the `sourcePath`/`onBacklog`-style local pre-flight,
   so an `--allow-backlog` build done-moves `tasks/backlog/ → tasks/done/`
   directly (the human's explicit drive IS the promotion; it never bounces
   through `tasks/ready/`). NOTE: the arbiter-side reconciler
   (`reconcileDoneMoveAgainstArbiter`) resolves the ACTUAL source folder from the
   arbiter and is the authority; confirm it likewise discovers a
   `tasks/backlog/`-resident slug (the local `source` is the fallback, not the
   authority — `complete.ts:641`). Must be explicit + tested.
5. **Same-slug in BOTH `tasks/backlog/` and `tasks/ready/` is a malformed state,
   not a case to design around (RESOLVED).** The contract's "status = the folder,
   one destiny" rule (WORK-CONTRACT.md L63) means a task rests in exactly one
   lifecycle position; a slug in both `backlog/` and `ready/` simultaneously is
   not a sanctioned state, and the done-move reconciler already "FAILS LOUD if
   the arbiter holds the slug in two folders with differing content"
   (`integration-core.ts:961`). So the resolver does not have to ARBITRATE a
   legitimate collision. The small remaining choice is the tie-break for the
   degenerate case: `resolveTask` searches `tasks-ready` BEFORE `tasks-backlog`
   (the ready copy wins) — keep that precedence; OPTIONALLY `--allow-backlog` MAY
   refuse loudly if the slug is also in `ready/` (a "you don't need the flag,
   it's already promoted" hint). Not load-bearing; the builder picks the cheaper.
6. **The skill mode is a spec without a mechanism today.** `drive-tasks`'s
   opt-in-backlog mode dispatches `do ... --isolated` against a `tasks/backlog/`
   slug, which currently throws. This PRD's flag is the missing primitive; the
   skill is updated to pass `--allow-backlog` and to state the
   drive-in-place-beats-promote-then-drive rationale.
7. **Generalise the principle into WORK-CONTRACT.md** (SOURCE
   `skills/setup/protocol/` + byte-identical `work/protocol/` mirror per
   AGENTS.md): staging is review-first admission AND the human-control position;
   promoting to the pool surrenders the item to any claimer, so "I want to drive
   this myself" = drive in place, never promote-then-drive.

> Tasked 2026-06-24. The launch-time Implementation/Testing detail has been
> relocated into the emitted tasks (`work/tasks/backlog/`); the durable WHY is
> kept in **Resolved decisions** above (including the rejected promote-on-claim
> alternative). See the task map in Further Notes.

## Out of Scope

- Any change to `run`'s daemon claim source or to CI's `advance` matrix — they
  stay pool-only by design (that is the whole point of the fence).
- Auto-promotion of staged tasks, or relaxing the review-first nature of staging
  for any non-explicit caller — `--allow-backlog` does NOT change staging's
  meaning for anyone who does not type it.
- A `--allow-proposed` analogue for PRDs — PRD tasking already solved its
  instance by tasking-in-place (TASKING-PROTOCOL.md §6); this PRD is the TASK
  instance only. (If a PRD-side build flag is ever wanted, it is a separate item.)
- The `do prd:` path — this is `do task:` resolution only.

## Further Notes

- Recurring-shape lineage: instance 1 = PRD tasking (`specs/proposed → ready`
  race), fixed by tasking in place (TASKING-PROTOCOL.md §6 + the
  `observation-discharge-...` PRD). Instance 2 = this (task building;
  `tasks/backlog → ready` race). The WORK-CONTRACT principle (Resolved decision
  7) is the generalisation so a third instance is caught by the doc, not
  rediscovered.
- **Task map (tasked 2026-06-24, born staged in `work/tasks/backlog/`):**
  - `do-allow-backlog-flag-resolver-claim-and-done-move` — US #1,#2,#3,#4 (keystone; `blockedBy: []`).
  - `allow-backlog-leak-fence-assertions` — US #4 (`blockedBy:` keystone).
  - `resolvetask-stale-backlog-vocab-doc-fix` — US #7 (`blockedBy:` keystone; same files).
  - `drive-tasks-dispatch-allow-backlog` — US #5 (`blockedBy:` keystone).
  - `work-contract-staging-is-human-control-position` — US #6 (`blockedBy: []`, docs-only, parallel).
  Chain: keystone → {leak-fence, doc-fix, drive-tasks} ; the WORK-CONTRACT task runs in parallel.
- Key evidence: `prompt.ts:567` (`resolveTask` order `['in-progress',
  'tasks-ready']`); `run.ts:929` (hardcoded `source: 'tasks-ready'`, the
  structural fence); `do.ts:969`/`:2121` (the two `resolveTask` call sites);
  `drive-tasks` SKILL §"Opt-in: drive tasks from `tasks/backlog/`" (the mode that
  needs this primitive); WORK-CONTRACT.md L24-26 / L215-225 (staging-as-position).
