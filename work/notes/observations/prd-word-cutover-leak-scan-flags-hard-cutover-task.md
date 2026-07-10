# Word cutover leak scan flags `hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md`

2026-07-10 — noticed while running `pnpm -r test` on an unrelated prose-cleanup task
(`reconcile-stale-needs-attention-folder-prose-after-lock-cutover`).

`packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` fails against a pre-existing
task body at `work/tasks/ready/hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md`
(lines 2, 3, 26) — the leak scanner flags standalone artifact-word occurrences
that are not on its PRESERVE allow-list. Confirmed pre-existing on `main` (stashing
my changes reproduces the same failure), so it is NOT caused by the prose task
above.

Likely fix: either sweep those mentions to `spec` in that task body, or add the
slug to the leak-scan allow-list — the task itself is intentionally about the
last back-compat removal, so the tension is real.
