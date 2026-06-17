---
title: pi harness relies on .jsonl session-log scraping in multiple places — worth a future polish pass to validate the approach
date: 2026-06-06
status: open
needsAnswers: true
---

## The signal

The pi harness adapter increasingly depends on **scraping pi's session `.jsonl` log** as its information channel, in several distinct places:

- **`--watch`** (`src/watch-session.ts`) tails the `.jsonl` and classifies `{type:"message", message:{role:"assistant", content:[…]}}` records to surface the live agent view.
- **liveness / activity** (`src/pi-harness.ts` `piSessionExists`, `sessionPointer`) uses the recorded `.jsonl` path as the activity + audit pointer alongside PID.
- **agent output** (the new `harness-agent-output` slice, Option C) reads the `.jsonl` for the LAST assistant message — the agent's final answer.

So `.jsonl`-scraping is now load-bearing for three different needs, all coupled to pi's **session-PERSISTENCE format** (which is pi-internal and can evolve — the `watch-session.ts` comments already note it differs from the `--mode json` STREAM format, and that a vocabulary mismatch once made `do --watch` a silent no-op).

## Why it's worth noting (not fixing now)

The `.jsonl` approach is the RIGHT tactical choice today — it reuses what pi already writes, adds no new convention, and the parser already exists. But:

1. It bets on an **internal, evolving file format** for three capabilities; a pi format change could silently break watch + output + audit at once.
2. There may be **better channels** for some of these (e.g. pi's own structured output mode, an SDK/IPC surface, or — as opencode does — a stream/HTTP API), which a cross-harness seam (the Option-C `LaunchResult.output` contract) makes room for. opencode, by contrast, exposes output as a stdout STREAM / `export` HTTP path, with NO plain persisted file — so the seam should not assume a file-shaped record in general.

## Disposition (for a future pi-harness-polish pass)

A dedicated pass should: (a) study the best method to get pi's agent output + liveness + watch view (not assume `.jsonl`-scraping is best for each), (b) revisit the EXISTING call sites (`watch-session.ts`, `pi-harness.ts`), not just the new output reader, and (c) keep the cross-harness `LaunchResult.output` contract (Option C) intact so opencode/other adapters fit the same seam. Until then, `harness-agent-output` deliberately REUSES the existing parser rather than inventing a parallel one — minimising the surface a polish pass must later reconcile.

(Captured during the batch-qa/review-gate work, 2026-06-06, while deciding how the review Gate-2 reads an agent verdict. Maintainer explicitly flagged the future polish pass.)
