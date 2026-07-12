---
type: observation
status: spotted
date: 2026-07-12
---

# `prd-word-cutover-leak-scan.test.ts` fails on cutover-provenance task bodies sitting in `work/tasks/ready/`

Noticed while completing `promote-rename-cutover-lessons-to-findings-note`. The
tree-wide WORD leak scan (`packages/dorfl/test/prd-word-cutover-leak-scan.test.ts`)
is RED against `main` (verified by `git stash -u` + re-running the test before
touching anything). The leaks are:

- `work/tasks/ready/promote-rename-cutover-lessons-to-findings-note.md` (lines 11, 24, 50) — this IS the current task's own body; its subject is the `prd`→`spec` cutover, so it quotes the retired word in prose. Similar bodies already sitting in `PROVENANCE_FILE_BASENAMES` (e.g. `hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md`) are exempt on the same ground.
- `work/tasks/ready/sweep-prose-prd-colon-from-live-maintained-docs-2026-07-12.md` (line 2) — unrelated ready task whose subject is the residual `prd:` prose sweep.

Both are legitimate cutover-provenance bodies that `PROVENANCE_FILE_BASENAMES`
would exempt if enumerated. Out of scope for this task (docs-only finding
promotion; must not touch task bodies or edit `.test.ts` allow-lists), but the
scan will keep failing CI until either (a) the two basenames are added to
`PROVENANCE_FILE_BASENAMES`, or (b) the tasks land and leave `ready/`. See
sibling note `prd-word-leak-scan-fails-on-bot-generated-triage-sidecars-2026-07-12.md`
for the same pattern on sidecars.
