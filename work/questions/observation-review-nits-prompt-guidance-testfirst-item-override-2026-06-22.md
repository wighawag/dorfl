<!-- dorfl-sidecar: item=observation:review-nits-prompt-guidance-testfirst-item-override-2026-06-22 type=observation slug=review-nits-prompt-guidance-testfirst-item-override-2026-06-22 allAnswered=false -->

## Q1

**This observation records two non-blocking review nits for the now-DONE task 'prompt-guidance-testfirst-item-override'. Both appear resolved by current reality: (nit 1) the SOURCE/MIRROR WORK-CONTRACT.md drift is gone (`diff skills/setup/protocol/WORK-CONTRACT.md work/protocol/WORK-CONTRACT.md` is clean); (nit 2) the design choices it asked you to ratify are now documented in WORK-CONTRACT.md §'`promptGuidance.*` per-item override' (dotted-scalar key form, no-prd symmetry, silent fall-through on a missing item file, item-level override semantics). What becomes of this signal — delete it as discharged, keep it for the historical ratification record, or mint a follow-up if you still want any choice explicitly ratified?**

> Source: work/notes/observations/review-nits-prompt-guidance-testfirst-item-override-2026-06-22.md (status: open, needsAnswers: true, reviewOf the now work/tasks/done/ task).
> Verification done at surface time:
> - Nit 1 (drift): `diff skills/setup/protocol/WORK-CONTRACT.md work/protocol/WORK-CONTRACT.md` => no diff. The extra trailing blank line the nit flagged is gone; byte-equality restored.
> - Nit 2 (ratify 5 choices / no Decisions block): WORK-CONTRACT.md lines 206-216 now document the override precedence and form explicitly, so the choices are ratified in-doc rather than only in code comments. frontmatter.ts:345 still carries the widened dotted-key regex `[A-Za-z0-9_.]+`.
> Note a vocabulary DRIFT in the nit text vs. current code: the nit describes a 'brief' tier (claims b/c/d say `work/briefs/ready|tasked`, brief lookup order). The repo has since renamed that tier to 'prd' — there is no `work/briefs/` dir and prompt.ts now resolves via the task's `prd:` (resolveItemPromptGuidanceForItem -> findPrdPath; precedence per-task > per-prd > repo). So nit 2's brief-specific sub-claims are stale; the underlying choices survive under the prd vocabulary.
> Git history shows a prior sidecar for this exact item was deleted (commit 3f8b8eb: 'rm stale sidecar ... rebuild via surface rung, new binary format'); this surface run is that rebuild.

_Suggested default: Delete the observation as discharged: both nits are resolved (drift clean, choices documented in WORK-CONTRACT.md), the task is done, and the nit text is partly stale (brief->prd rename). No new task is warranted._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
