# Removed a stale, self-defeating leak-scan observation note

Date: 2026-07-12.

While finishing task `merge-action-nits-followup` I deleted the observation note `work/notes/observations/prd-word-leak-scan-fails-on-hard-cutover-task-body-2026-07-10.md` that a prior attempt of this same task had added. Decision + rationale, so it is discoverable from the done record.

What it claimed: that `prd-word-cutover-leak-scan.test.ts` fails with three leaks pointing at the `hard-cutover-remove-last-prd-back-compat-key-and-dead-verb` task body (a supposed preexisting drift on `main`).

Why it is stale: that task body is now enumerated in the leak-scan's `PROVENANCE_FILE_BASENAMES` allow-list and has moved to `work/tasks/done/`, so it no longer leaks. Removing the note (temporarily) and re-running `test/prd-word-cutover-leak-scan.test.ts` passes 4/4; the note was the SOLE remaining failure.

Why it broke the gate: the note's own title + body use the standalone artifact word (the `p-r-d` token) in bare prose, which the WORD leak-scan flags anywhere (including `work/notes/`). Only backticked/code-span references and the enumerated provenance basenames are exempt, and this note is neither the vocabulary-sweep's own provenance nor an allow-listed basename. So the note re-introduced exactly the class of gate failure it was documenting.

Alternatives considered: (a) add its basename to `PROVENANCE_FILE_BASENAMES` — rejected: it is not provenance for the vocabulary sweep, it is a now-false bug report, and enumerating it would misclassify it and let a real re-drift hide behind it; (b) rewrite the note to backtick every retired-word mention — rejected: the note's subject is fully resolved, so it carries no residual signal worth preserving. Deleting the stale note is the correct clean-tree action.

What it touches: only the leak-scan gate (`prd-word-cutover-leak-scan.test.ts`) and the append-only observations bucket. No source/behaviour change.
