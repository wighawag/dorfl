# prd-word cutover leak-scan fails on the `hard-cutover-remove-last-prd-back-compat-key-and-dead-verb` task body

Date: 2026-07-10.

Observed while running `pnpm -r test` on the `merge-action-nits-followup` branch: the
`prd-word-cutover-leak-scan.test.ts` gate fails with three leaks pointing at
`work/tasks/ready/hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md`
(lines 2, 3, 26) — the task body itself uses the artifact word `prd` where the
gate now expects `spec`. Reproduces against a clean `HEAD` (verified by stashing
this task's diffs and re-running the single file), so it is preexisting drift on
`main`, not caused by this task. Out of scope; noted so it is not lost.
