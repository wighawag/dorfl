## Context

Gate 2 (code review) approved the task `finish-needs-attention-folder-cutover-remove-legacy-recovery-readers` but flagged three non-blocking nits. This task bundles all three into one small mechanical follow-up. The human's triage decision was: nit 1 becomes an ADR; nits 2 and 3 are a single code/doc cleanup. We bundle them here (the ADR write-up is a deliverable of this task, not a separate signal) so the follow-up lands atomically.

## Scope

Three independent changes, all confined to `packages/dorfl/src/` and `docs/adr/`.

### 1. Open an ADR ratifying three unrecorded decisions from the finished task

Add ONE new ADR under `docs/adr/` covering the three non-obvious in-scope decisions the finished task made but did not record on its done-record `## Decisions` block. The ADR is the single durable anchor future readers can find; it is cheaper than amending a landed done-record.

Decisions to record (context / decision / why for each):

- **(a) `complete.ts` post-cutover default branch falls through to `'tasks-ready'` so `existsSync(sourcePath)` fires the refusal.** File: `packages/dorfl/src/complete.ts` roughly L745–805 (default branch + `sourcePath` construction + refusal message + `const recovering = false`). The task's final AC explicitly asked for this to be recorded. WHY: post-cutover there is no legitimate `needs-attention` residence, so the default branch treats a missing source as the canonical 'nothing to complete' shape rather than dispatching to a folder-probe.
- **(b) The `recovering: boolean` field on `IntegrationCoreInput` is kept as VESTIGIAL.** Files: `packages/dorfl/src/integration-core.ts` around L307–325, L637, L1089 (`void recovering;`). Every internal reader is deleted, every internal caller hard-codes `false`, and the field is preserved ONLY so external callers still compile. WHY: cross-caller API-stability decision — the cost of a coordinated breaking removal outweighed the benefit given the field is now inert.
- **(c) The `CompleteRefusal` user-visible message changed** from `work/tasks/ready/${slug}.md (nor work/needs-attention/${slug}.md) found` to `work/tasks/ready/${slug}.md not found — nothing to complete (already done, or wrong slug?)`. WHY: post-cutover the parenthetical about `needs-attention/` was misleading (that residence is impossible), and the new wording gives an actionable hint (already done / wrong slug).

Link the ADR from the done-record of `finish-needs-attention-folder-cutover-remove-legacy-recovery-readers` (a small pointer, not an amendment of the record's own Decisions block).

### 2. Drop `'needs-attention'` from `TASK_LIFECYCLE_FOLDERS` (closure scan miss)

File: `packages/dorfl/src/work-layout.ts` around L215–225. Remove `'needs-attention'` from the `TASK_LIFECYCLE_FOLDERS` array. This is the executable folder-probe shape the original cutover AC explicitly demanded be gone ("no EXECUTABLE folder probe remains anywhere in `packages/dorfl/src/`"); the closure scan missed it because it is currently behaviour-safe (nothing writes the folder, so `listMarkdown` yields `[]`).

Callers that iterate this array and therefore need to be updated:

- `packages/dorfl/src/close-job.ts` L57 + L177 — iterates `TASK_LIFECYCLE_FOLDERS` calling `listMarkdown(repoPath, folder)`.
- `packages/dorfl/src/prd-complete.ts` L36 + L97 — same shape.

If either caller's residence set legitimately diverges from the shared one after the drop, inline a small explicit local array at that call-site rather than reintroducing `'needs-attention'` into the shared constant. Prefer the simplest form: if both callers end up with the same set post-drop, the shared constant just loses one entry.

### 3. Fix stale JSDoc in `prd-complete.ts`

File: `packages/dorfl/src/prd-complete.ts` L29–33. The module JSDoc still describes a task being in `work/needs-attention/` as a legitimate pre-done resting state ("A task that has NOT yet landed in `work/done/` (still in backlog / in-progress / needs-attention) means the prd is not yet complete"). Post-cutover that residence is impossible, so the file's own description contradicts its behaviour. Drop the `needs-attention` mention from the prose.

## Acceptance criteria

- New ADR file exists under `docs/adr/` covering decisions (a), (b), (c) above, each with context / decision / why. The ADR is linked from the done-record of `finish-needs-attention-folder-cutover-remove-legacy-recovery-readers` via a small pointer.
- `TASK_LIFECYCLE_FOLDERS` in `packages/dorfl/src/work-layout.ts` no longer contains `'needs-attention'`.
- `close-job.ts` and `prd-complete.ts` compile and behave correctly against the shrunken array (with local inline arrays only if their residence set genuinely diverges).
- No executable folder probe against `work/needs-attention/` remains anywhere in `packages/dorfl/src/` (grep for `'needs-attention'` should show only non-executable references — comments, ADR pointers, tests asserting absence, etc.).
- The `prd-complete.ts` L29–33 JSDoc no longer lists `needs-attention` as a legitimate pre-done resting state.
- Acceptance gate green: `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check`.

## Out of scope

- Removing the vestigial `recovering: boolean` field from `IntegrationCoreInput` (the ADR ratifies keeping it; a coordinated removal is a separate future task if/when external callers can be migrated).
- Amending the landed done-record's own `## Decisions` block (the ADR + a pointer is the chosen substitute).

## Provenance

Derived from observation `review-nits-finish-needs-attention-folder-cutover-remove-legacy-recovery-readers-2026-06-25`, which the human triaged as: promote nits 2+3 into one small follow-up task, handle nit 1 as an ADR, then delete the observation. The ADR write-up is folded into this task as deliverable #1 so the follow-up lands atomically.