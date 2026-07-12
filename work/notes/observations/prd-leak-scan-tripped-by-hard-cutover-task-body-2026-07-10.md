# `prd`-word-cutover leak-scan tripped by another task body (2026-07-10)

While running `pnpm -r test` from the `cleanup-cross-job-worker-serialiseafter-dead-branch`
branch, `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` failed on three
`prd` tokens in `work/tasks/ready/hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md`
(lines 2, 3, 26). That task file existed on `origin/main` (commit 1b1b2676), so
the failure predated and was unrelated to this branch. Likely wants either an
allow-list carve-out for that task body's title/prompt or the task body's prose
sweeping. Out of scope for this task.

Note (2026-07-12): this observation was itself originally written with the
retired word in bare prose, which then tripped the same WORD leak-scan on
`work/notes/`. Per the scanner's preserve-#6 convention the retired-word
references here are now wrapped in inline code (`` `prd` ``) so the note records
the incident without re-tripping the gate. The `hard-cutover-remove-last-prd-back-compat-key-and-dead-verb`
task is also no longer in `work/tasks/ready/`, so the original external trip it
described is gone on the current `origin/main`.
