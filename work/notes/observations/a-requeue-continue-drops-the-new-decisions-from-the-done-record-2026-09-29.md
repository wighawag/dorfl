# A `requeue` continue drops the continuation's `## Decisions` from the done record

Date: 2026-09-29
Observer: conductor of a drive-tasks run over wighawag/etherfold (dorfl 0.13.4, code checked against dorfl `origin/main` a8324ca2).

When a task bounces, is requeued (keep + continue) and rebuilt, the done record keeps ONLY the first attempt's `## Decisions` block. The continuation's decisions reach the PR body but never the durable record. Cause: `transcribeDecisionsIntoDoneRecord` (`packages/dorfl/src/integration-core.ts`) is idempotent by skipping any record that already has a `## Decisions` heading. The first attempt's done-move already wrote one on the kept `work/<type>-<slug>` branch, so the continue's block is silently discarded. The guard was meant to prevent a DUPLICATE of the same block, but a continue carries a NEW block.

Two instances in one drive:

- etherfold `the-stratagems-replay-records-its-ci-figures` (PR #263): Gate-3 blocked the first attempt (revert bound 75 minutes, `timeout-minutes: 185`), and the requeued rebuild changed them to 80 and 190. The merged done record still stated 75 and 185 as the decisions, contradicting the code it ships with. The conductor appended a correction by hand (etherfold e303e16).
- etherfold `query-layer-drive-small-fixes` (PR #257): the continuation's one real decision (the tab-bundle canary now detects the query tier by implementation rather than by the reserved names) is in the PR body only; the done record carries the first attempt's decisions.

Expected: a continue appends its block under a dated or attempt-numbered heading (for example `## Decisions (continuation, <date>)`), and the idempotency check compares the block's CONTENT, not the heading's presence, so a re-run of the same output still does not duplicate.

Related, already handled elsewhere: the requeue handoff note colliding with the kept branch's done-move on the continue rebase hit this drive three times on 0.13.4 (every time the note was appended after `## Prompt`). It is fixed on `main` by #432 and e972795d but not yet released; etherfold pins `^0.13.4`, so it needs the next release.
