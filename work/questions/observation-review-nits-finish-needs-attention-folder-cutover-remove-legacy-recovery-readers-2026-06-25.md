<!-- dorfl-sidecar: item=observation:review-nits-finish-needs-attention-folder-cutover-remove-legacy-recovery-readers-2026-06-25 type=observation slug=review-nits-finish-needs-attention-folder-cutover-remove-legacy-recovery-readers-2026-06-25 allAnswered=false -->

## Q1

**What becomes of this observation overall — promote each nit to a follow-up task, keep the note open for later, or delete it as not-worth-acting-on?**

> Gate 2 of 'finish-needs-attention-folder-cutover-remove-legacy-recovery-readers' APPROVED but emitted three non-blocking nits parked here for triage (see work/notes/observations/review-nits-finish-needs-attention-folder-cutover-remove-legacy-recovery-readers-2026-06-25.md). The header explicitly frames the disposition choice as 'promote-to-task / keep / delete'. Each nit below also has its own substantive question; this top-level question asks what to do with the SIGNAL itself.

_Suggested default: Promote nits 2 and 3 into a single small follow-up task (they are mechanical code/doc cleanups), and either ratify nit 1 in-place by amending the done record / opening an ADR or accept it as water-under-the-bridge — then delete this observation._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Promote nits 2 and 3 into a single small follow-up task (mechanical code/doc cleanups, Q3/Q4), and handle nit 1 (Q2) as an ADR. Then delete this observation.

## Q2

**Nit 1 — ratification of unrecorded decisions: should we retroactively record the three non-obvious decisions (complete.ts default branch falling through to 'tasks-ready'; vestigial `recovering: boolean` on IntegrationCoreInput; the changed CompleteRefusal message) by amending the done-record's `## Decisions` block and/or opening an ADR, or accept that the rationale lives only in inline code comments and move on?**

> The task's final AC said 'Non-obvious in-scope decisions are recorded… An un-recorded keep/cut is a review finding.' No `## Decisions` block was added, no ADR opened, and the commit body is empty. Sites: complete.ts L745–805 (default branch + sourcePath refusal + `const recovering = false`); integration-core.ts L307–325, L637, L1089 (`void recovering;`).

_Suggested default: Open one ADR covering all three (default-branch refusal contract, vestigial `recovering` field rationale, refusal-message wording change) and link it from the done record — cheaper than amending a landed record and gives future readers a single anchor._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Open one ADR covering all three unrecorded decisions (default-branch refusal contract, vestigial `recovering` field rationale, refusal-message wording change) and link it from the done record. Cheaper than amending a landed record and gives future readers a single anchor. (This is the ADR route, distinct from the RELAX-on-Decisions-block answer: these are non-obvious enough to warrant a real ADR, not just an inline note.)

## Q3

**Nit 2 — `'needs-attention'` in TASK_LIFECYCLE_FOLDERS: drop it from the array (and split prd-complete.ts / close-job.ts's residence set off if needed), or explicitly retain-with-justification as an intentional legacy reader?**

> work-layout.ts L215–225 still lists `'needs-attention'` in TASK_LIFECYCLE_FOLDERS; close-job.ts L57+L177 and prd-complete.ts L36+L97 iterate it calling `listMarkdown(repoPath, folder)`. Behaviour-safe today (nothing writes the folder, so iteration yields []), but the task's closure AC reads 'no EXECUTABLE folder probe remains anywhere in packages/dorfl/src/' — this is exactly that shape. The agent's closure scan missed it.

_Suggested default: Drop `'needs-attention'` from TASK_LIFECYCLE_FOLDERS and inline an explicit small array at the two call-sites if their residence-set diverges — matches the cutover's stated goal of zero executable legacy probes._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Drop `'needs-attention'` from TASK_LIFECYCLE_FOLDERS and inline an explicit small array at the two call-sites (close-job.ts, prd-complete.ts) if their residence-set diverges. This is exactly the "no executable folder probe remains" shape the cutover AC demanded, and the closure scan missed it. Bundle into the nit-2/3 follow-up task.

## Q4

**Nit 3 — stale JSDoc in prd-complete.ts L29–33 (still describes `work/needs-attention/` as a legitimate pre-done resting state): fix the prose, or leave it?**

> Post-cutover, residence in work/needs-attention/ is impossible, so the module's own description contradicts the new behaviour. Trivial doc fix.

_Suggested default: Fix it — drop the `needs-attention` mention from the JSDoc (or note it as a vestigial legacy reader if nit 2 lands as retain-with-justification). Bundle with nit 2's code change in one small follow-up._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

Fix it: drop the `needs-attention` mention from prd-complete.ts L29-33 JSDoc (post-cutover that residence is impossible, so the description contradicts behaviour). Bundle with nit 2's code change in the same small follow-up task.
