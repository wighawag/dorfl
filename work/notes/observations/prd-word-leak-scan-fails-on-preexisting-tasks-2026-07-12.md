2026-07-12: `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` and
`packages/dorfl/test/prd-to-spec-leak-scan.test.ts` fail against many pre-existing
files unrelated to this task's scope. Not touched by
`rename-pre-backlog-to-backlog-in-cli-prose-and-config`.

Original hit (2 unswept task bodies) was fixed on `main` in 7be9bd2d, but at
requeue time the tree-wide gate is red again on this branch tip (rebased on
main) against a NEW set of unrelated bodies/notes containing the standalone
artifact word `prd`, plus a `work/prd-tasked/` string in
`docs/adr/vocabulary-cutover-word-vs-identity-boundary-and-preserve-list.md`,
plus a missing provenance file
`word-scan-exempts-prd-cutover-task-bodies-2026-07-10.md`.

Concretely, `pnpm -r test` on `HEAD` reports the leaks in (non-exhaustive):
  - work/notes/observations/rename-spec-emit-sites-batch-4d-decisions.md
  - work/tasks/ready/exempt-work-questions-sidecars-from-prd-word-leak-scan.md
  - work/tasks/ready/fold-three-surface-distinction-into-rename-cutover-lessons.md
  - work/tasks/ready/mint-rename-expand-checklist-finding.md
  - work/tasks/ready/promote-rename-cutover-lessons-to-findings-note.md
  - work/tasks/ready/provenance-file-basenames-widened-criterion-and-expiry-guard.md
  - work/tasks/ready/review-protocol-add-file-ownership-lens-for-wide-refactor-chains.md
  - docs/adr/vocabulary-cutover-word-vs-identity-boundary-and-preserve-list.md

This is a tree-wide gate that catches unrelated content and blocks any task
that touches nothing prd-related. Either those bodies need a sweep or the scan's
PRESERVE allow-list / provenance registry needs entries. Not this task.
