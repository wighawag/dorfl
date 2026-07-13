# 2026-07-12 — `prd-word-cutover-leak-scan` red on two pre-existing `work/tasks/ready/` files

While completing the unrelated `mint-rename-expand-checklist-finding` task, verified (via `git stash -u` then re-run) that `test/prd-word-cutover-leak-scan.test.ts` was already failing on `main` before any change in this task. Flagged files:

- `work/tasks/ready/promote-rename-cutover-lessons-to-findings-note.md` (lines 11, 24, 50)
- `work/tasks/ready/sweep-prose-prd-colon-from-live-maintained-docs-2026-07-12.md` (line 2)

Not touched here — noting so the signal is captured.
