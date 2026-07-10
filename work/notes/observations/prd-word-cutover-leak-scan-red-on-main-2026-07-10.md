# Observation — `prd-word-cutover-leak-scan.test.ts` red on `origin/main` (2026-07-10)

Noticed while working `f2-mirror-path-staging-test-and-ratify-decisions`: on a clean
`origin/main` (i.e. before any local changes), `pnpm -C packages/dorfl test` fails
in `test/prd-word-cutover-leak-scan.test.ts` because
`work/tasks/ready/hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md`
(committed to main by 1b1b2676) contains three standalone `prd` word tokens
outside the PRESERVE allow-list, which the scan is designed to reject. The task
body is FOR the cutover work itself, so the leak-scan and the task-body use the
word for legitimate reasons — but the two collide on main.

Not fixed here (out of scope for the mirror-path test task). Two likely resolutions:
either allow-list that task-body basename in `prd-word-cutover-leak-scan.test.ts`
until the cutover task lands, or promote/complete the cutover task so the file
leaves `ready/`. Flagging so the signal is captured.
