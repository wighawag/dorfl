<!-- dorfl-sidecar: item=observation:review-nits-rename-residual-slice-test-labels-and-skill-provenance-2026-06-23 type=observation slug=review-nits-rename-residual-slice-test-labels-and-skill-provenance-2026-06-23 allAnswered=false -->

## Q1

**What becomes of this observation's still-live nit #1 — the close-job.test.ts 'prd case' describe + my-prd fixtures were NEVER renamed to brief/task vocabulary despite the task's Gate-3 follow-up explicitly directing it: promote a small follow-up task to finish that describe coherently, or ratify leaving the partial-rename wart and drop the observation?**

> This observation recorded three Gate-2 nits on the (now done/) task 'rename-residual-slice-test-labels-and-skill-provenance'. Re-checking each against the CURRENT tree (the observation predates the task's Gate-3 follow-up):
>
> NIT #1 (close-job.test.ts) IS STILL LIVE — and is now an acceptance gap, not just a coherence wart. The task's own Gate-3 follow-up (work/tasks/done/rename-residual-slice-test-labels-and-skill-provenance.md, '## Gate-3 follow-up') explicitly directed: describe 'runCloseJob — the PRD case (...)' -> '... the brief case', and slug fixtures my-prd -> my-brief. Current packages/dorfl/test/close-job.test.ts:114 still reads "runCloseJob — the prd case" (merely lowercased, not 'brief case'); :115 "closes the prd's issue"; :158 "finds the prd issue from work/prds/tasked/"; :208 "...via the prd only". grep: 17x 'my-prd', 0x 'my-brief'. Only the lone-slice->lone-task half of the follow-up landed (:172,:173,:190). The task's acceptance criterion '...close-job.test.ts describe-string + test-name prose and fixtures (my-prd) read task/brief vocabulary' is therefore NOT satisfied. Tests stay green (the toContain('my-prd') at :134 matches the my-prd fixtures), so this is vocabulary-only, but the half-rename leaves one describe block readable in mixed old/new vocabulary.
>
> NIT #2 (scan.test.ts:396 stale `sliceablePrds` comment vs live `taskableBriefs`) is ALREADY split off and surfaced on its own: work/notes/observations/test-comments-cite-renamed-sliceablePrds-symbol-2026-06-23.md with an open sidecar question in work/questions/observation-test-comments-cite-renamed-sliceablePrds-symbol-2026-06-23.md (default: promote-task). Re-surfacing it here would duplicate that; this question deliberately excludes it.
>
> NIT #3 (no `## Decisions` block) is closed by its own text ('nothing to ratify beyond the scoping calls already flagged') and the skill self-sufficiency landed cleanly: skills/drive-tasks/SKILL.md:156 now states the freshWorktreeGate behaviour with the --no-fresh-worktree-gate opt-out and NO slicer-review-edit-loop / gate-on-rebased-tip-fresh-worktree provenance.
>
> So the only open judgement this observation carries is the disposition of nit #1.

_Suggested default: promote-task — a tiny self-contained follow-up that finishes the close-job.test.ts describe sweep (describe '... the prd case' -> '... the brief case'; 'prd's issue'/'the prd' prose -> brief/task wording; my-prd -> my-brief with the matching brief:/toContain refs), keeping the existing fixture-FOLDER-word scope fence ('prd'/'prd-sliced' first args owned by clean-break-fixture-folder-vocab-compat-seam). It closes a stated-but-unmet acceptance criterion of the original task, is vocabulary-only, and is cheap; alternatively the human may consciously ratify the residual and drop this observation if the partial rename is acceptable._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Promote a tiny self-contained follow-up task to finish the close-job.test.ts describe sweep (describe '... the prd case' -> '... the brief case'; 'prd's issue'/'the prd' prose -> brief/task wording; my-prd -> my-brief with matching brief:/toContain refs), keeping the existing fixture-FOLDER-word scope fence ('prd'/'prd-sliced' first args owned by clean-break-fixture-folder-vocab-compat-seam). This closes a stated-but-unmet acceptance criterion of the original task, so it is not just a coherence wart. Nit #2 is separately surfaced and nit #3 is closed. Then delete this observation.
