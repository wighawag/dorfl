## Context

The pi harness adapter currently relies on **scraping pi's internal session `.jsonl` log** in three load-bearing places:

- **`--watch`** (`src/watch-session.ts`) tails the `.jsonl` and classifies `{type:"message", message:{role:"assistant", content:[…]}}` records to surface the live agent view.
- **liveness / audit** (`src/pi-harness.ts` `piSessionExists`, `sessionPointer`) uses the recorded `.jsonl` path as the activity + audit pointer alongside PID.
- **agent output** (the `harness-agent-output` slice, Option C) reads the `.jsonl` for the LAST assistant message — the agent's final answer.

This was the right tactical choice (reuses what pi already writes, adds no new convention, parser already exists), but it bets three capabilities on an **internal, evolving** pi persistence format. `watch-session.ts` comments already note this format differs from the `--mode json` STREAM format, and a vocabulary mismatch once made `do --watch` a silent no-op. A single pi format change could silently break watch + output + audit at once.

A maintainer explicitly flagged this for a future polish pass (captured 2026-06-06 during the batch-qa/review-gate work while deciding how review Gate-2 reads an agent verdict). This task is that queued polish pass — it is NOT a fix-now defect.

## Disposition (verbatim from the source observation)

A dedicated pass should:

1. **Study the best channel per need** — do NOT assume `.jsonl`-scraping is the right answer for each of {agent output, liveness, watch view}. Consider pi's own structured output mode, an SDK/IPC surface, or a stream/HTTP API (as opencode exposes).
2. **Revisit the EXISTING call sites**, not just the new merged output reader: `src/watch-session.ts` and `src/pi-harness.ts` (`piSessionExists`, `sessionPointer`) are equally in scope.
3. **Preserve the cross-harness `LaunchResult.output` seam (Option C)** so a stdout-stream / HTTP-shaped harness like opencode still fits the same contract. The seam must NOT assume a file-shaped record in general — opencode exposes output as a stdout STREAM / `export` HTTP path with no persisted file.

## Non-goals / current state to preserve

- Until this pass runs, `harness-agent-output` deliberately REUSES the existing `.jsonl` parser rather than inventing a parallel one, to minimise the surface this pass must later reconcile. Do not fork a second parser in the meantime.
- The Option-C `LaunchResult.output` contract is the cross-harness seam; keep it intact.

## Definition of done

- Written analysis of the best channel for each of the three needs (output / liveness / watch), with a recommendation per need (may or may not stay `.jsonl`).
- Updates to `src/watch-session.ts` and `src/pi-harness.ts` (`piSessionExists`, `sessionPointer`) and the `harness-agent-output` reader consistent with those recommendations.
- `LaunchResult.output` (Option C) still fits both pi and a stream/HTTP-shaped harness (opencode-style) without assuming a persisted file.
- Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.
