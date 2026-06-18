---
title: Lock-substrate slices (#3-#9) had an inverted, unbuildable dependency order; re-scoped to Option A (interim dual-write)
date: 2026-06-18
status: open
prd: ledger-status-per-item-lock-refs
relatesTo: [claim-acquires-unified-lock-no-body-move, slicing-acquires-unified-lock, advancing-acquires-unified-lock, needs-attention-as-stuck-lock-state, complete-lock-then-durable-main-move-crash-safe, retire-transient-folders-and-drop-rebase]
---

## What was noticed

While driving the `ledger-status-per-item-lock-refs` backlog (via `drive-backlog`),
slice #3 `claim-acquires-unified-lock-no-body-move` STOPped at build time (routed
itself to `needs-attention/` without writing code) with a verified analysis: it
could not be built green IN ISOLATION because its mandate REMOVES the
`work/in-progress/<slug>.md`-on-`main` artifact (claim writes nothing to `main`,
body stays in `backlog/`, `--resume` reads no in-progress body), but
`complete`/`start`/`needs-attention`/`do`/`run` and ~25 test files still consume that
artifact by folder, and the slices that retarget THOSE consumers (#6/#7/#9) were
declared `blockedBy` #3. An inverted order: #3's own acceptance gate
(`pnpm -r test`) could never be green because the consumer-retargets that fix the
breakage are gated behind #3.

The same structural trap applied to #4 `slicing-acquires-unified-lock` (removing the
`work/slicing/` marker breaks ~9 src consumers + tests) and #5
`advancing-acquires-unified-lock` (removing the `work/advancing/` marker breaks
`ledger-lint`/`ledger-write`/`cli` + tests). All three "retarget X off its `main`
marker" slices removed a transient `main` artifact whose consumer-fixes were
concentrated in the capstone #9, BEHIND them.

Verified against current code: `complete.ts` sources its `git mv` from `in-progress/`
("SOURCE folder is normally `work/in-progress/`"); `start.ts` dispatch is folder-based
on `in-progress/` ("The decision is folder-based"); the `slicing/`/`advancing/`
folders are read by many src modules (grep-confirmed). The build agent did not guess;
it surfaced the fork. (Slices #1 and #2 were genuinely additive and merged cleanly,
PRs #160, #161.)

## Resolution (decided: conductor + human, Option A)

Re-scoped #3/#4/#5/#6 to INTERIM DUAL-WRITE and EXPANDED #9 into the full cut-over:

- #3 claim, #4 slicing, #5 advancing, #6 needs-attention each now ALSO acquire/mark
  the unified lock but KEEP their legacy `main` artifact (the `in-progress/` body
  move, the `slicing/`/`advancing/` markers, the `needs-attention/` folder bounce),
  so every existing folder consumer + test stays green. The lock becomes the eventual
  exclusion/in-flight substrate additively.
- #7 complete keeps its existing durable move (interim source `in-progress/`, NOT
  `backlog/`) and ADDS the hold-lock -> main-move-first -> release-second ordering +
  the `main`-authoritative-over-stale-lock recovery rule (substrate-agnostic, carries
  through unchanged).
- #8 release-lock verb + gc report was already purely additive; unchanged.
- #9 retire-transient-folders is EXPANDED to own the full cut-over: stop the legacy
  transient writes (claim body move, slicing/advancing markers), retarget every
  legacy folder CONSUMER onto the lock/`backlog/` (complete source -> `backlog/`,
  start/resume/do/run read held-ness from the lock ref, update the ~25 tests), THEN
  retire the four transient folders + delete `drop-bookkeeping-rebase`. If that
  cut-over is too large to land green in one pass, #9's prompt instructs the builder
  to STOP and surface a sub-slicing proposal (one consumer-family per slice) rather
  than guess a partial cut-over.

This concentrates the only behaviour-removing risk in #9, where the consumers are
finally all lock-aware, while keeping #3-#8 as small, individually-green,
tracer-bullet slices. The PRD's end-state (claim writes nothing to `main`; no
transient status on `main`) is unchanged; only the SEQUENCING to reach it green is.

## Suggested disposition

Leave as a record of why the slice bodies carry RE-SCOPED / SCOPE-EXPANDED banners.
A future reader who only reads the ADR (which states the end-state) needs this to
understand why #3-#6 still dual-write in the interim. Candidate to fold a one-line
note into the PRD's Implementation & Testing Decisions block at next triage.
