2026-07-12: `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` fails against
two pre-existing task bodies in `work/tasks/ready/` — `promote-rename-cutover-lessons-to-findings-note.md`
and `sweep-prose-prd-colon-from-live-maintained-docs-2026-07-12.md` — which contain
the standalone artifact word `prd`. Not touched by this task; leaked into `main`
in commit 70a29752 before this task claimed the lock, so the acceptance gate is
red BEFORE our changes were introduced. Either the task bodies need a sweep or
the scan's PRESERVE allow-list needs an entry.
