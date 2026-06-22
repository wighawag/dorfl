<!-- agent-runner-sidecar: item=observation:review-nits-work-layout-guard-catch-absolute-prefix-path-literals-2026-06-20 type=observation slug=review-nits-work-layout-guard-catch-absolute-prefix-path-literals-2026-06-20 allAnswered=false -->

## Q1

**Triage the single non-blocking Gate-2 review nit on 'work-layout-guard-catch-absolute-prefix-path-literals': should the structural choice to keep `refPrefix` and `pathPrefix` as a parallel `(?:refPrefix|pathPrefix)?` alternation (rather than a folded combined prefix) be ratified, and if so should a follow-up slice retroactively add an explicit `## Decisions` block to the done file / a future PR body recording it — or is the in-source comment in `test/work-layout-guard.test.ts` sufficient and the observation can be dropped?**

> Gate 2 approved the slice. The slice prompt explicitly asked the agent to RECORD non-obvious in-scope decisions (specifically calling out the prefix alternation shape) in a Decisions record. The diff implements the separated form with an in-source comment explaining why, but no Decisions block exists in the done file and the commit body (a79e806) is empty. Options: (a) promote-slice — open a tiny slice to amend the done-file with a `## Decisions` block and/or update WORK-CONTRACT/template to make the Decisions block a stronger convention; (b) keep — leave the observation open if the broader 'should Decisions blocks be enforced' question is still in flux; (c) delete/dropped — accept the in-source comment as sufficient record and close, since Gate 2 already approved without it.

_Suggested default: dropped — the in-source comment in the test file captures the rationale at the exact site of the choice, Gate 2 approved without the Decisions block, and chasing a retroactive done-file edit is process churn for a single nit; revisit only if a pattern of missing Decisions blocks emerges across multiple slices._

<!-- q1 fields: id=q1 disposition=dropped -->

**Your answer** (write below this line):

DROPPED — the rationale is durably recorded at the choice site (the in-source comment in `test/work-layout-guard.test.ts` documenting the parallel `refPrefix`/`pathPrefix` alternation), Gate 2 already approved without a `## Decisions` block, and a retroactive done-file edit is churn for one nit. Part of the recurring "decision recorded in-source, not in a `## Decisions` block" pattern captured in the meta-observation — if it recurs a third time, that pattern is worth its own "enforce-or-relax the Decisions convention" item rather than chasing this one retroactively. Disposition: dropped.
