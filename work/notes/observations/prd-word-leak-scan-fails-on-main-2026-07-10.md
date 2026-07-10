# prd-word-cutover-leak-scan fails on main (2026-07-10)

Observed while running the acceptance gate for
`merge-question-surfacer-review-nit-tidyup`: `pnpm -r test` fails on
`packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` because the task file
`work/tasks/ready/hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md`
contains standalone `prd` tokens on lines 2, 3, 26 that are not in the
PRESERVE allow-list. Both the leak-scan test and the offending task file are
already on `origin/main` (commit `1b1b2676`), so the failure is pre-existing
and unrelated to this task's doc-comment changes. The obvious resolvers are
the follow-up task itself (the hard-cutover task) or adding the file to the
PRESERVE allow-list — not scope here.
