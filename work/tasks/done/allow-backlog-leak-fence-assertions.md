---
title: Leak-fence assertions — --allow-backlog is explicit-invocation-only
slug: allow-backlog-leak-fence-assertions
spec: do-allow-backlog-drive-staged-tasks-without-promotion
blockedBy: [do-allow-backlog-flag-resolver-claim-and-done-move]
covers: [4]
---

## What to build

Prove, with tests, that `--allow-backlog` can be reached ONLY via an explicit
human-typed `do` invocation (or human-driven `drive-tasks` passing it) — never
by an autonomous path. This guards against re-creating the competition bug one
layer down (a daemon claiming staged tasks).

End-to-end behaviour:

- A test asserting the `run` daemon's claim/integration path resolves/claims only
  `tasks-ready` regardless of any flag — it calls `performIntegration` directly
  with a hardcoded `source: 'tasks-ready'` (it never parses `do`'s CLI flags), so
  `--allow-backlog` is structurally unreachable from `run`.
- A test (or guard) asserting `do`'s auto-pick path selects only from the pool
  and never sets `--allow-backlog` (it defaults off).
- Confirm CI's `advance` matrix does not pass the flag (it has no reason to;
  assert/document that the autonomous surface never sets it).

This is a test/guard task — it adds NO new production behaviour beyond confirming
the fence the keystone relies on.

## Acceptance criteria

- [ ] A test proves the `run` claim path is pool-only (`tasks-ready`) and cannot
      be made to claim `tasks/backlog/` via the flag.
- [ ] A test proves `do` auto-pick never sets `--allow-backlog` (defaults off).
- [ ] The autonomous `advance`/CI surface is asserted/documented to never pass
      the flag.
- [ ] Tests mirror the existing `run`/`do`-autopick test style.

## Blocked by

- `do-allow-backlog-flag-resolver-claim-and-done-move` — the flag must exist
  before its non-leakage can be asserted.

## Prompt

> Goal: lock in the explicit-invocation-only fence for `--allow-backlog`, per the
> PRD `do-allow-backlog-drive-staged-tasks-without-promotion` (US #4, Resolved
> decision 3 — the fence is structural).
>
> Where to look: `run.ts` (the daemon calls `performIntegration` directly with a
> hardcoded `source: 'tasks-ready'` — it does not parse `do`'s flags, so the flag
> physically cannot reach it); `do`'s auto-pick selection path (`do-autopick`);
> the CI `advance` matrix invocation. Add tests asserting none of these can set
> or honour `--allow-backlog`.
>
> This is a guard/test task: it should add coverage, not new runtime behaviour.
> If you find a path where the flag COULD leak into an autonomous claimer, that
> is a real defect — fix it (close the leak) and note it, do not just assert the
> happy path.
