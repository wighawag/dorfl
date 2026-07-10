# prd-word-cutover-leak-scan is pre-existing red — 2026-07-10

While running `pnpm -r test` for `reaper-reap-terminal-stuck-lock-orphans`
I found `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` FAILS on the
main baseline (verified via `git stash` + re-run against the pristine tree —
same failure, my changes touch nothing related). The leak is inside
`work/tasks/ready/hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md`
(lines 2, 3, 26): standalone `prd` tokens outside the PRESERVE allow-list.
That task's spec is the `prd → spec` vocabulary cutover, so the leak IS the
next hop of that migration — but it means the tree is currently red on `test`.
Not fixing here (out of scope); flagging so the tracker for that task sees it.
