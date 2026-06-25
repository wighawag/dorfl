---
title: review-gate non-blocking nits for 'finish-needs-attention-folder-cutover-remove-legacy-recovery-readers' (Gate 2 approve)
date: 2026-06-25
status: open
reviewOf: finish-needs-attention-folder-cutover-remove-legacy-recovery-readers
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'finish-needs-attention-folder-cutover-remove-legacy-recovery-readers' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: the agent did not record a `## Decisions` block on the done record or open an ADR, despite the task's final AC requiring one for the surprising/hard-to-reverse choices. Rationale lives only as inline code comments. The non-obvious in-scope decisions worth a Decisions/ADR entry: (a) `complete.ts`'s post-cutover default branch falls through to `'tasks-ready'` so the `existsSync(sourcePath)` refusal fires (the AC explicitly asked this to be recorded); (b) the `recovering: boolean` field on `IntegrationCoreInput` is kept as VESTIGIAL — every reader is deleted, every caller hard-codes `false`, the field is only preserved so external callers compile (a cross-caller decision); (c) the `CompleteRefusal` user-visible message changed from `work/tasks/ready/${slug}.md (nor work/needs-attention/${slug}.md) found` to `work/tasks/ready/${slug}.md not found — nothing to complete (already done, or wrong slug?)`.
  (complete.ts L745–805 (default branch + sourcePath + refusal message + `const recovering = false`); integration-core.ts L307–325, L637, L1089 (`void recovering;`). The task AC says: 'Non-obvious in-scope decisions are recorded… An un-recorded keep/cut is a review finding.' Commit message body is empty; no ADR added in `docs/adr/`; the done-record task body was not amended.)
- Missed kind-(1) closure: should the `'needs-attention'` entry in `TASK_LIFECYCLE_FOLDERS` (and the corresponding live `listMarkdown(repoPath, 'needs-attention')` calls in `close-job.ts` and `prd-complete.ts`) be removed or explicitly retained-with-justification? It survived the agent's closure scan unmentioned. It IS an executable folder probe driving control flow in two callers (the prd-completeness query and the lone-task close-job query iterate it). It is currently behaviour-safe because nothing writes the folder, so the iteration yields the empty list — but that is exactly the 'orphaned legacy reader' shape the task set out to retire (the task's closure AC reads 'no EXECUTABLE folder probe remains anywhere in packages/dorfl/src/'). Either drop `'needs-attention'` from `TASK_LIFECYCLE_FOLDERS` (and split prd-complete / close-job's residence set off if needed) or record it as an intentional legacy reader.
  (packages/dorfl/src/work-layout.ts L215–225 (`TASK_LIFECYCLE_FOLDERS` still contains `'needs-attention'`); packages/dorfl/src/close-job.ts L57+L177 and packages/dorfl/src/prd-complete.ts L36+L97 both iterate that array calling `listMarkdown(repoPath, folder)` against the on-disk `work/needs-attention/` dir.)
- Stale prose in `prd-complete.ts`'s module JSDoc: it still describes a task being in `work/needs-attention/` as a legitimate pre-done resting state ('A task that has NOT yet landed in `work/done/` (still in backlog / in-progress / needs-attention) means the prd is not yet complete'). Post-cutover that residence is impossible. Worth a small doc fix to either drop the `needs-attention` mention or note it is a vestigial legacy reader, so the file's own description doesn't contradict the cutover.
  (packages/dorfl/src/prd-complete.ts L29–33.)
