---
needsAnswers: true
---

# Requeued `reaper-reap-terminal-stuck-lock-orphans`: two self-inflicted leak-scan reds fixed — 2026-07-11

Continuing the requeued `reaper-reap-terminal-stuck-lock-orphans` branch, `pnpm -r test` was RED on two files, and both reds were introduced by the prior attempt itself (verified against pristine `origin/main`, where both are green), NOT pre-existing:

1. `docs/adr/ledger-status-on-per-item-lock-refs.md:124` — the prior attempt's Addendum wrote the terminal-folder list as a `` `brief-tasked` `` inline-code span. `docs/**` is gated by `prd-to-spec-leak-scan.test.ts`, whose `DEAD_TOKEN_LITERAL` flags a whole `` `brief-tasked` `` code span (starts with the retired `brief-` token) and `isExemptMarkdownDataToken` does not exempt it. Fixed by rewriting that line to the code's ACTUAL current-vocabulary terminals per `terminalMainPaths` (a task at `tasks/done` / `tasks/cancelled`, a spec at `specs/tasked` / `specs/dropped`), which is both factually correct and passes the gate.

2. `work/notes/observations/prd-word-cutover-leak-scan-pre-existing-red-2026-07-10.md` — an observation note the prior attempt wrote claiming the leak-scan was "pre-existing red" in `work/tasks/ready/hard-cutover-remove-last-...`. That premise was false on THREE counts: the referenced file is in `tasks/done/` (not `ready/`), `work/tasks/done/**` is terminal-history the WORD scan treats as immutable provenance, and the note itself carried a standalone retired artifact-word in prose that `prd-word-cutover-leak-scan.test.ts` (which walks `work/**`) rightly flagged. The note misdiagnosed a self-inflicted red and was itself half of that red. REMOVED it (its premise does not hold).

Decision recorded here (append-only bucket, per the harness's decision-capture rule) rather than in the item body, which the runner owns. With both fixes the acceptance gate `pnpm -r build && pnpm -r test && pnpm format:check` is green; the reaper contract change (stuck + terminal-on-`main` is now the auto-reapable `cleared-stuck-terminal` / `reaped-stuck-terminal` class; stuck + non-terminal stays the human-only `kept-stuck`) and its ADR Addendum are otherwise as the prior attempt built them.
