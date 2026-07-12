---
title: 'DECISION: merge-question-surfacer-review-nit-tidyup drops a prior-attempt leak-scan note that itself reddened the gate'
date: 2026-07-12
---

## Context / what I saw

`merge-question-surfacer-review-nit-tidyup` is a doc-comment-only tidy of `packages/dorfl/src/merge-question-surfacer.ts` (three ratified review nits). Its acceptance requires the full gate `pnpm -r build && pnpm -r test && pnpm format:check` to be green. Continuing the requeued `work/task-merge-question-surfacer-review-nit-tidyup` branch, I found the three doc-comment edits already made and CORRECT, but the branch also carried a stray committed observation note `work/notes/observations/prd-word-leak-scan-fails-on-main-2026-07-10.md` written by the earlier attempt.

That note claimed the WORD leak-scan (`packages/dorfl/test/prd-word-cutover-leak-scan.test.ts`) was "pre-existing red on main" because of standalone artifact-word tokens in `work/tasks/ready/hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md`. That premise is FALSE now:

- Clean `origin/main` PASSES the leak-scan (I built a fresh `origin/main` worktree, installed, and ran the test: 4 passed).
- The `hard-cutover-...` task has since moved to `work/tasks/done/`, where `isTerminalHistory` exempts its `prd:` provenance, so it no longer flags.
- The ONLY file the scan flags on this branch is that prior note itself: its prose carries the bare artifact word outside code spans. The failure was self-inflicted by the note, not pre-existing.

The correct pre-existing capture of the same incident already lives on main as `prd-word-leak-scan-flags-hard-cutover-task-body-2026-07-10.md`, and the exemption mechanism is documented in `word-scan-exempts-prd-cutover-task-bodies-2026-07-10.md`.

## Decision

DELETE the misdiagnosed note `prd-word-leak-scan-fails-on-main-2026-07-10.md`. It duplicates an existing on-main note, its factual claim is wrong, and keeping it reds the acceptance gate my task must leave green. Removing a wrong artifact left by an aborted attempt is producing clean WORK, not git work.

- **Alternative considered:** ship the red note and mark the task done anyway (what the prior attempt did) — REJECTED, acceptance explicitly requires a green gate; shipping a known red gate on a false premise is exactly the failure mode this protocol warns against.
- **Alternative considered:** add the note basename to the scan `PROVENANCE_FILE_BASENAMES` allow-list, or backtick the offending prose in place — REJECTED, that would preserve a note whose content is factually wrong (a duplicate misdiagnosis), which is worse than deleting it.
- **What it touches:** ONLY `work/notes/observations/` (an append-only capture bucket anyone may add to or prune). It touches no source, no other task, no flag or command. The three doc-comment nits (the task actual deliverable) are unchanged.

Linked from the done record for ratification.
