# prd-word-cutover-leak-scan red on main (pre-existing)

Date: 2026-07-10
Noticed while: building `harden-test-in-process-concurrent-land-review-nits`.

`pnpm --filter dorfl exec vitest run prd-word-cutover-leak-scan` fails on a
clean tree (no local changes — reproduced via `git stash`). The scan flags
three standalone `prd` occurrences in
`work/tasks/ready/hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md`
(lines 2, 3, 26). That task file's very purpose is to complete the prd→spec
cutover, so it self-referentially trips the guard. Not touched by this task;
recorded so the signal is not lost. Presumably the task itself, when built,
resolves the leak or teaches the scan to exempt its own body.
