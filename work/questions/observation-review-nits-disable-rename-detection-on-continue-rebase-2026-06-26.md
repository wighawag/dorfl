<!-- dorfl-sidecar: item=observation:review-nits-disable-rename-detection-on-continue-rebase-2026-06-26 type=observation slug=review-nits-disable-rename-detection-on-continue-rebase-2026-06-26 allAnswered=false -->

## Q1

**This observation is marked `status: addressed` — all three non-blocking nits (ADR, regression test at integration-core seam, Decisions block) were resolved in the continuation pass on the same task branch. What becomes of this signal now: delete it (its job is done, the durable why lives in the new ADR + the regression test + the done task record), keep it as a historical triage record, or is there residual follow-up worth promoting to a task/PRD?**

> work/notes/observations/review-nits-disable-rename-detection-on-continue-rebase-2026-06-26.md frontmatter: `status: addressed`. The '2026-06-26 follow-up' block reports each nit resolved:
>  - Nit 1 → docs/adr/runner-rebase-rename-detection-off.md added.
>  - Nit 2 → regression test added in packages/dorfl/test/integration-core.test.ts under 'integration-core — directory-rename detection MUST stay off on the integrate-tail rebase' (uses a non-`.md` sibling so reconcileSiblingLedgerConflict cannot mask the failure; FAILS without the flag, PASSES with it).
>  - Nit 3 → decisions recorded inline in the continuation done record / report, plus durable home in the new ADR + the test's comments.
> The observation's triage prompt itself says: 'promote-to-task / keep / delete.' Since every nit has a discharge artefact, there is no open code residue against current reality (ADR exists; regression test exists at the named seam; decisions are recorded).

_Suggested default: Delete — the signal has done its job. The durable why lives in docs/adr/runner-rebase-rename-detection-off.md and the integration-core regression test; nothing further needs surfacing, and keeping an 'addressed' observation in work/notes/observations/ just adds noise to triage._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
