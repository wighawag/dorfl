<!-- dorfl-sidecar: item=task:review-nits-prompt-guidance-test-first-2026-06-21 type=task slug=review-nits-prompt-guidance-test-first-2026-06-21 allAnswered=false -->

## Q1

**This task is still a placeholder stub ('Promoted from observation ... draft this into a buildable slice') carrying needsAnswers:true, but the three nits it was created to capture all appear RESOLVED in now-done sibling slices. Should this task be dropped/closed as overtaken-by-events, or is there a residual slice still to build? If residual, what concretely is it?**

> work/tasks/ready/review-nits-prompt-guidance-test-first-2026-06-21.md body is only the promotion stub with no '## Open questions' block. Meanwhile prompt-guidance-testfirst-{config-and-prompt-seam,item-override,setup-adoption-question}.md are all in work/tasks/done/. The seam nit was answered (Option A, ADR docs/adr/prompt-wrapper-conditional-fragments.md), replace-vs-append answered (REPLACE), env-var pinned (DORFL_PROMPT_GUIDANCE_TEST_FIRST in packages/dorfl/src/config.ts), and per-task>per-brief>repo precedence implemented in the item-override done slice. The source observation is already marked 'Triaged: promoted' AND 'Triaged: keep' (resolved).

_Suggested default: Close/drop this task as overtaken-by-events: all three captured nits were resolved when the sibling slices were built and landed in tasks/done/, leaving nothing for this stub to build._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Close/drop as overtaken-by-events. All three captured nits were resolved when the sibling slices landed in tasks/done/ (config-and-prompt-seam, item-override, setup-adoption-question), leaving nothing for this stub to build. Discharge via the cancelled/drop path (nothing to build).

## Q2

**Nit 1 (seam + replace/append): the keystone slice deferred BOTH the seam mechanism (A conditional fragment / B variant wrapper / C append line) and the replace-vs-append phrasing. These were answered as Option A and REPLACE in the done config-seam slice. Is anything about that resolution still open, or is this nit fully discharged?**

> work/notes/observations/...md nit 1; resolved in work/tasks/done/prompt-guidance-testfirst-config-and-prompt-seam.md '## Applied answers 2026-06-22' (q1=Option A with HTML-comment markers + ADR; q2=REPLACE, folding the house-style cue into the strengthened text). Implemented per packages/dorfl/src/config.ts comments.

_Suggested default: Discharged: q1/q2 are answered, recorded, ADR'd, and implemented in the done slice; nothing remains._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Discharged. q1 (Option A conditional fragment with HTML-comment markers + ADR) and q2 (REPLACE) are answered, recorded, ADR'd, and implemented in the done config-seam slice. Nothing remains.

## Q3

**Nit 2 (env-var name): should the env var have been pinned at slicing time? It was ultimately pinned to DORFL_PROMPT_GUIDANCE_TEST_FIRST. Confirm this name is the intended one and that no follow-up is needed.**

> work/notes/observations/...md nit 2 (keystone slice hedged 'DORFL_PROMPT_GUIDANCE_TEST_FIRST or whatever matches existing naming'). packages/dorfl/src/config.ts now documents the resolution chain with the concrete env var DORFL_PROMPT_GUIDANCE_TEST_FIRST.

_Suggested default: Confirmed/no follow-up: the concrete name DORFL_PROMPT_GUIDANCE_TEST_FIRST is in the shipped resolver._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Confirmed, no follow-up. The concrete env var DORFL_PROMPT_GUIDANCE_TEST_FIRST is pinned in the shipped resolver (config.ts).

## Q4

**Nit 3 (precedence ADR): the item-override slice introduced a per-task > per-brief > repo precedence the brief did not explicitly rank. Did this fresh design call warrant an ADR, and if so was one recorded, or is documenting it in WORK-CONTRACT.md sufficient?**

> work/notes/observations/...md nit 3. work/tasks/done/prompt-guidance-testfirst-item-override.md §3 implements per-task > per-brief > repo-resolved and its acceptance criteria require documenting it in WORK-CONTRACT.md (SOURCE skills/setup/protocol/ + MIRROR work/protocol/), but only docs/adr/prompt-wrapper-conditional-fragments.md exists for this feature, not a precedence ADR.

_Suggested default: Sufficient as documented: the three-tier precedence mirrors the existing humanOnly/autoBuild item-override shape, so WORK-CONTRACT.md documentation is enough and no separate ADR is owed._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

Sufficient as documented. The per-task > per-spec > repo precedence mirrors the existing humanOnly/autoBuild item-override shape, so the WORK-CONTRACT.md documentation is enough; no separate precedence ADR is owed.
