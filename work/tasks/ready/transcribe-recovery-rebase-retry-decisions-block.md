## Context

Gate 2 review of the merged task `recovery-rebase-retry-against-moving-arbiter-main` (PR #225, landed) approved integration but flagged that its acceptance criterion — 'A `## Decisions` block records: cap chosen and why; contention-vs-outage; jitter; reconcile-arms decision; rename-detection orthogonality' — was NOT satisfied in the protocol-native location. The decisions ARE thoroughly recorded, but only in code comments inside `packages/dorfl/src/integration-core.ts` (the `DEFAULT_RECOVERY_REBASE_RETRIES` doc-comment, the `DEFAULT_RECOVERY_REBASE_JITTER_MS` doc-comment, and the long block-comment above the recovery retry loop). The done task file `work/tasks/done/recovery-rebase-retry-against-moving-arbiter-main.md` has no `## Decisions` heading; commit `d1ab93c`'s body is empty.

Human disposition of the parent observation (`observation:review-nits-recovery-rebase-retry-against-moving-arbiter-main-2026-06-24`):

- **Transcribe** the decisions into a `## Decisions` block on the done task file, sourced verbatim from the existing code comments. This is one of the rare cases where the record genuinely wasn't made anywhere durable-and-linked, so it is worth transcribing rather than waving through under RELAX. The in-repo done-record edit is the protocol-native home (task already merged; no live PR description to amend).
- **Ratify** `DEFAULT_RECOVERY_REBASE_RETRIES = 4` (5 total attempts) as-is — conservative contention cap, overridable via `params.recoveryRebaseRetries`; revisit only if a real incident shows bursts outlasting 5 attempts.
- **Confirm** the bare recovery rebase (no `rebaseOntoMainWithReconcile()` arms). Rationale: the done-move was already committed upstream so divergent-done-move has nothing to act on, and a sibling-ledger conflict on a re-fetched main is the same shape the original run would hit. If a divergent-done-move case is later observed in the recovery path, reuse the SAME reconcile path (no second copy).
- **Rename-detection orthogonality** update: PR #224 (`disable-rename-detection-on-continue-rebase`) was CLOSED UNMERGED — its implementation used the WRONG git knob (`-Xno-renames` / `merge.renames=false` do NOT suppress the observed DIRECTORY-rename conflict; only `-c merge.directoryRenames=false` does, verified on git 2.47.3). The sibling is parked in `work/tasks/backlog/disable-rename-detection-on-continue-rebase.md` with a CORRECTION banner. The `rebaseArgs()` thunk this task left in `integration-core.ts` on `main` therefore does NOT yet carry any rename-off option; the corrected sibling task will slot `-c merge.directoryRenames=false` into that one args site when re-done. The Decisions block should state this reality (sibling parked, thunk currently bare, correct knob is `merge.directoryRenames`).
- **Deferred cleanup (opportunistic, low priority):** unify the Race-1 jitter (currently uses the local non-injectable `sleepMs`) onto the same injectable `Sleep` seam from `retry-backoff.ts` that the new recovery loop uses — when next touching that code. Do not mint dedicated work just for this; capture it as a note in the Decisions block / this task body so it isn't lost.

## Scope

1. Add a `## Decisions` block to `work/tasks/done/recovery-rebase-retry-against-moving-arbiter-main.md` transcribing the decisions from the code comments in `packages/dorfl/src/integration-core.ts`. The block MUST cover the five items the acceptance criterion enumerates:
   - **Cap chosen and why:** `DEFAULT_RECOVERY_REBASE_RETRIES = 4` (5 total attempts). Ratified as a conservative contention cap; overridable via `params.recoveryRebaseRetries`. Deliberately different shape from Race-1's cap of 1000 (which is a liveness ceiling). Revisit only on a real incident showing bursts outlasting 5 attempts.
   - **Contention-vs-outage:** (verbatim from the doc-comment / block-comment — transcribe the existing wording).
   - **Jitter:** `DEFAULT_RECOVERY_REBASE_JITTER_MS` rationale from the doc-comment.
   - **Reconcile-arms decision:** the recovery re-rebase is deliberately BARE (no `rebaseOntoMainWithReconcile()` arms). Rationale as recorded in the block-comment above the retry loop; confirmed load-bearing. If a divergent-done-move case is later observed in the recovery path, reuse the SAME reconcile path (do not fork a second copy).
   - **Rename-detection orthogonality:** sibling task PR #224 was closed unmerged (wrong knob); sibling is parked in backlog with a CORRECTION banner. The `rebaseArgs()` thunk site is currently bare; the corrected sibling will slot `-c merge.directoryRenames=false` (NOT `-Xno-renames` / `merge.renames=false`, which do not suppress the DIRECTORY-rename conflict — verified on git 2.47.3).

   Source the wording verbatim from the code comments where practical, and add a short lead-in noting this block is a post-hoc transcription to satisfy the acceptance criterion (the task was already merged as PR #225).

2. Add a small trailing note in the same `## Decisions` block (or a `## Follow-ups` sub-section) recording the opportunistic cleanup: unify Race-1's local `sleepMs` jitter onto the injectable `Sleep` seam from `retry-backoff.ts` when next touching that code. The new recovery seam is strictly better (RNG also injected). Not worth minting dedicated work.

## Non-goals

- Do NOT change any code in `packages/dorfl/src/integration-core.ts` in this task. The sleep-seam unification is deferred to opportunistic future work; this task only records the intent.
- Do NOT re-open or re-do the parked sibling `disable-rename-detection-on-continue-rebase`; that has its own backlog entry with a CORRECTION banner.
- Do NOT amend the merged commit `d1ab93c` or PR #225.

## Acceptance

- `work/tasks/done/recovery-rebase-retry-against-moving-arbiter-main.md` contains a `## Decisions` block covering all five bullets above, sourced from the existing code comments.
- The block explicitly states the rename-detection orthogonality reality: sibling PR #224 closed unmerged, sibling parked in backlog, thunk currently bare, correct knob is `merge.directoryRenames` (not `merge.renames`).
- The opportunistic sleep-seam unification note is captured somewhere in the done record so it isn't lost.
- `pnpm -r build && pnpm -r test && pnpm format:check` green (docs-only change; should be trivially green).

## Parent observation

Close `work/observations/review-nits-recovery-rebase-retry-against-moving-arbiter-main-2026-06-24.md` once this task lands (it was kept open as the triage record for the Gate-2 nits and its remaining actionables all fold into this task).

## Prompt

> Build the task 'transcribe-recovery-rebase-retry-decisions-block', described above.
