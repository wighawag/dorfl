---
title: review-gate non-blocking nits for 'pre-backlog-staging-folder-and-promote-step-a' (Gate 2 approve)
date: 2026-06-17
status: open
reviewOf: pre-backlog-staging-folder-and-promote-step-a
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'pre-backlog-staging-folder-and-promote-step-a' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the un-recorded `## Decisions` (the slice Prompt explicitly required them). The agent's PR/done record carries none, but the diff makes at least five non-obvious in-scope choices a human should sign off on.
  ((1) `STAGED_SLICES_DIR = 'work/pre-backlog'` is exported from `src/slicing.ts` as a one-shot constant rather than hoisted into a shared path module (the slice deliberately forbade introducing `work-layout`; this is the local stand-in until STEP B). (2) Promotion commit subject shape: `chore(${slug}): promote work/pre-backlog/ -> work/backlog/` (`needs-attention.ts:812`). (3) A new `'promote'` member is added to the `LedgerTransitionKind` union in `ledger-write.ts` — a cross-cutting concept other transitions key off. (4) `promoteFromPreBacklog` lives in `needs-attention.ts` (alongside `returnToBacklog`/`surfaceStuckInProgress`), not in `ledger-write.ts` as the slice Prompt suggested — defensible because that's actually where `returnToBacklog` lives, so the Prompt was just out of date, but worth pinning. (5) The pool-placement fence (`scrubPoolDrift`) is SILENT — it `rmSync`s an agent's added file under `work/backlog/` and `git checkout HEAD --` reverts modifications without emitting a `note()`; tests assert the outcome but a human operator watching the slicing run sees no signal that an agent tried to self-place.)
- Ratify the `promote`-when-both-source-and-dest-exist behaviour (the slice Prompt explicitly raised duplicate-slug as an open question).
  (`promoteFromPreBacklog` first does `hasSource`/`hasDest` probes on `<arbiter>/main`; if both exist (the same slug already resides in `work/backlog/` AND in `work/pre-backlog/`), the call proceeds into `runTreelessLedgerMove`, whose `plan` callback checks `pathInCommit(base, destRel)` FIRST and returns `'already-done'`. Net effect: the staged file is silently orphaned in `pre-backlog/` (never cleaned up) and the promotion reports `moved:true` / `commitMessage` with no actual main move. This is defensible idempotence, but the orphaned staged file is invisible to the caller — a future promote on the same slug will keep returning the same way until a human notices.)
- Coherence nit: `slicer-review-loop.ts` hardcodes `'work/pre-backlog/'` ~6 times (the prefix fence, the slice of the prefix to get the filename, the prompt text, the `newOrChangedBacklog` reader) instead of importing `STAGED_SLICES_DIR` from `slicing.ts`.
  (`packages/agent-runner/src/slicer-review-loop.ts:477,481,486,518,535,668,669`. Two modules now own a copy of the staged-folder path; the next folder rename (STEP B) has to find them both. Trivial to fix by importing the constant — recommend folding into STEP B's `work-layout` extraction.)
