# `prd-word-cutover-leak-scan` test is red on main (pre-existing) — 2026-07-14

Test `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` fails on a clean
tree (verified via `git stash` baseline while working on task
`rename-gc-ledger-stuck-lock-report-to-orphan-lock`, which touches only
`WORK-CONTRACT.md` mirrors + one test describe label — unrelated).

Leaked hit: `work/tasks/ready/backfill-where-it-runs-decision-migrate-stuck-locks-done-record.md`
line 19 contains a standalone artifact-word `` `prd` `` outside the PRESERVE
allow-list. Either that task body needs a sweep to `spec`, or an allow-list
entry, or the task itself is supposed to perform the cleanup.
