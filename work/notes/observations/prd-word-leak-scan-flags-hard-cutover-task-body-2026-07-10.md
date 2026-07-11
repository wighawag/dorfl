# 2026-07-10 — `prd-word-cutover-leak-scan.test.ts` is red on `main` for an unrelated task body

Full suite (`pnpm -r test`) has one failure independent of
`reap-squash-merged-remote-work-branches`: `test/prd-word-cutover-leak-scan.test.ts`
flags three standalone `prd` tokens in
`work/tasks/ready/hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md`
(lines 2, 3, 26). Reproduces on `main` before this task's edits too. Likely
just that ready-task's body needs the `prd → spec` sweep (or an allow-list
exemption per the leak-scan's contract).
