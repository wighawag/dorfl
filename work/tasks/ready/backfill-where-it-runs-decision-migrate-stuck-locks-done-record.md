---
promotedFrom: observation:review-nits-migrate-existing-stuck-locks-one-shot-2026-07-14
---

## What to build

The original task `migrate-existing-stuck-locks-one-shot` (Gate 2 approved) explicitly required: *"RECORD the where-it-runs decision durably, linked from the done record."* The decision — that the migration ships as a dedicated CLI verb `dorfl migrate-stuck-locks` (Advanced/plumbing group) rather than folded into `gc --ledger` or shipped as a one-shot script — currently only exists as an inline code comment at `packages/dorfl/src/cli.ts:3909-3920`. The done record at `work/tasks/done/migrate-existing-stuck-locks-one-shot.md` has 0 lines added: no `## Decisions` block, no ADR link.

Backfill that durable record. Minimum viable: add a `## Decisions` section to the done record that captures the where-it-runs choice + rationale (one-shot rollout with WRITE semantics on main; distinct from `gc`'s report + orphan-reap surface; exit-code contracts kept separate) and cites `cli.ts:3909-3920` as the inline evidence. If you prefer an ADR under `docs/adr/`, mint it and LINK it from the done record — the point is the done record must no longer be empty on this decision.

Out of scope: nits 2-4 from the review-gate observation (skipped-no-item-form policy, exit-code contract, test-coverage gap) — those were ratified and left on record in the observation itself; do not touch them here.

## Prompt

> The task `migrate-existing-stuck-locks-one-shot` shipped and passed Gate 2, but its done record `work/tasks/done/migrate-existing-stuck-locks-one-shot.md` is empty — 0 lines added — even though the original task prompt required "RECORD the where-it-runs decision durably, linked from the done record." The decision itself is real and lives as an inline comment in `packages/dorfl/src/cli.ts` around lines 3909-3920: the migration ships as a dedicated CLI verb `dorfl migrate-stuck-locks` in the Advanced/plumbing group, rather than folded into `gc --ledger` or shipped as a one-shot script. The recorded rationale: one-shot rollout with WRITE semantics on main; distinct from `gc`'s report + orphan-reap surface; exit-code contracts kept separate.
>
> Your job is to backfill that durable record. Do the smallest coherent thing: either (a) add a `## Decisions` section to the done record with the where-it-runs choice + rationale summarised in prose (and citing `cli.ts:3909-3920` as the inline source), OR (b) mint a short ADR under `docs/adr/` capturing the same decision and LINK it from the done record. Either satisfies the original prompt; pick one and be consistent. Do NOT edit `cli.ts` or change any migration behaviour — this is a documentation backfill only.
>
> Do NOT touch the other nits from the review (skipped-no-item-form policy, exit-code contract on body-absent drain, test-coverage gap for slice-*/prd- and body-absent paths). Those were ratified in the review-gate observation and are staying on record there; they are out of scope for this task.
>
> Acceptance gate: `pnpm -r build && pnpm -r test && pnpm format:check` still passes (this is a docs-only change so build/test should be untouched, but format:check must be clean). The done record `work/tasks/done/migrate-existing-stuck-locks-one-shot.md` must, after your change, either contain the decision inline (`## Decisions` block) or link to an ADR that contains it. Follow the standard git etiquette in `AGENTS.md`: you do not stage/commit/push and you do not move files between `work/` folders — the runner owns those transitions.