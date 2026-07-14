---
title: review-gate non-blocking nits for 'migrate-existing-stuck-locks-one-shot' (Gate 2 approve)
date: 2026-07-14
status: open
reviewOf: migrate-existing-stuck-locks-one-shot
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'migrate-existing-stuck-locks-one-shot' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the where-it-runs decision: the migration landed as a dedicated CLI verb 'dorfl migrate-stuck-locks' (Advanced/plumbing group) rather than folded into 'gc --ledger' or shipped as a one-shot script. The rationale (one-shot rollout with WRITE semantics on main, distinct from gc's report + orphan-reap surface, exit-code contracts kept separate) is recorded inline in cli.ts but was NOT captured in a durable ADR/finding as the task prompt requested ('RECORD the where-it-runs decision durably, linked from the done record'). The done record itself is empty.
  (Task prompt: 'Where this runs (a decision to make + record)... pick the smallest coherent home and record why.' cli.ts:3909-3920 documents the choice; work/tasks/done/migrate-existing-stuck-locks-one-shot.md is unchanged (0 lines added).)
- Ratify the 'skipped-no-item-form' policy: a pre-cutover `slice-*`/`prd-` legacy stuck ref is REPORTED but LEFT IN PLACE (outcome skipped-no-item-form, exit 0, message points the human at 'release-lock --entry <literal>'). The task says 'no PRE-EXISTING stuck lock is silently stranded'; this is not silent (reported + hint) but the migration deliberately does not drain those refs. Reasonable given they have no on-main body to flip and no --force is desired, but it is an in-scope agent decision worth ratifying.
  (migrate-stuck-locks.ts outcome 'skipped-no-item-form' + migrateStuckLocksNeedsAttention returning false for it (exit 0 when only skips remain).)
- Ratify the exit-code contract: exit 1 only when lost>0 or errors>0; a 'migrated-body-absent' drain is exit 0 (counted as success — lock drained, no body to surface). Consistent with the D1 body-absent semantics in surfaceStuckToNeedsAttention, but a fresh user-visible default worth noting.
  (migrateStuckLocksNeedsAttention() body; needs-attention.ts:1936 bodyAbsent branch.)
- Test coverage gap (informational): the body-absent path and the `slice-*`/`prd-` skipped-no-item-form path have no dedicated test — only the happy path, idempotency, reason/questions round-trip, and the healthy-active untouched case are covered. Non-blocking because both branches are small and reuse well-tested primitives.
  (packages/dorfl/test/migrate-stuck-locks.test.ts covers 4 scenarios; no seed of a slice-<slug> lock or a stuck ref without an on-main body.)
