<!-- dorfl-sidecar: item=observation:review-nits-ci-template-parallel-merge-fanout-2026-06-26 type=observation slug=review-nits-ci-template-parallel-merge-fanout-2026-06-26 allAnswered=false -->

## Q1

**What should become of this observation collecting the two non-blocking Gate-2 nits for 'ci-template-parallel-merge-fanout' — promote one or both to a tiny follow-up task, fold the L409 rephrase into the next task that touches advance-lifecycle-template.ts, or just delete the observation as drive-by debt the repo accepts?**

> The observation (work/notes/observations/review-nits-ci-template-parallel-merge-fanout-2026-06-26.md) records two nits from an APPROVED Gate-2 review of an already-done task:
>   1. The task/PR never landed a '## Decisions' block ratifying the six in-scope decisions (a)-(f) the requeue prompt explicitly asked for (merge legs --watch; shared enumerate; AND-guard on enumerate.any; '-n' driver removed; fail-fast:false on merge matrix; no GHA concurrency). Confirmed: work/tasks/done/ci-template-parallel-merge-fanout.md has no '## Decisions' section — the requeue note (line 69) explicitly demanded it, yet the done task lacks it. This is archaeology-loss, not a code bug.
>   2. One stale '-n' comment survived cleanup at packages/dorfl/src/advance-lifecycle-template.ts:409 ('The merge job re-scans the pool inside `advance -n`'), inconsistent with the new per-item `dorfl advance "<item>" --merge` shape. The sibling stale references at L550 / seed L274 were fixed; this one was missed. Pure prose nit, no behaviour change.
> Both are explicitly NON-BLOCKING per Gate 2, so the question is purely about disposition of the residue, not correction urgency.

_Suggested default: Split: (1) DELETE — the missing '## Decisions' block is on a done task whose decisions are now embedded in shipped code and the requeue history; retroactively editing a done-task file for archaeology has low ROI and the engine does not require it. (2) Fold the L409 one-line rephrase into the next task that touches advance-lifecycle-template.ts (drive-by fix) rather than minting a standalone task for a single comment. Net action: delete the observation, leaving the L409 nit as latent drive-by debt._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Delete the observation. (1) The missing `## Decisions` block is on a done task whose decisions are now embedded in shipped code and the requeue history; retro-editing a done-task file for archaeology has low ROI and the engine does not require it. (2) Fold the L409 `-n` comment rephrase into the next task that touches advance-lifecycle-template.ts as a drive-by fix, rather than minting a standalone task for one comment. Net: delete the observation, leaving the L409 nit as latent drive-by debt.
