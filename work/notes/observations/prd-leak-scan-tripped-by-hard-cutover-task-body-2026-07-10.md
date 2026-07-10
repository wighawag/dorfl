# prd-word-cutover leak-scan tripped by another task body (2026-07-10)

While running `pnpm -r test` from the `cleanup-cross-job-worker-serialiseafter-dead-branch`
branch, `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` fails on 3
'prd' tokens in `work/tasks/ready/hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md`
(lines 2, 3, 26). That task file exists on `origin/main` (commit 1b1b2676), so
the failure predates and is unrelated to this branch. Likely wants either an
allow-list carve-out for that task body's title/prompt or the task body's prose
sweeping. Out of scope for this task.
