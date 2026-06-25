<!-- dorfl-sidecar: item=observation:advance-task-folder-set-omits-tasks-backlog-staged-surface-items-misroute-to-build-2026-06-24 type=observation slug=advance-task-folder-set-omits-tasks-backlog-staged-surface-items-misroute-to-build-2026-06-24 allAnswered=false -->

## Q1

**This observation's reported bug is already FIXED in the current tree. What should become of this signal: delete it as discharged, or keep it open to track the secondary hardening it suggested (folding the two folder-set constants into one shared source)?**

> The observation reported that advance.ts `FOLDERS_FOR_TYPE` omitted `tasks-backlog`/`prds-proposed`, so staged `needsAnswers` items mis-routed to the build rung and died in claim with 'not found on origin/main'. Verified against current code:
> - packages/dorfl/src/advance.ts:426-429 `FOLDERS_FOR_TYPE` now reads `task: ['tasks-backlog', 'tasks-ready', 'in-progress', 'done']` and `prd: ['prds-proposed', 'prds-ready', 'prds-tasked']` — i.e. staging-inclusive, exactly the suggested fix direction.
> - advance.ts:413-425 carries a doc comment that EXPLAINS the staging inclusion and cites THIS observation by slug.
> - The suggested regression test exists: test/advance.test.ts:341-348 is a REGRESSION test naming this observation, seeding a staged `needsAnswers` task in `tasks/backlog/` and asserting the classifier sees `needsAnswers` (surface rung), not a claim.
> So the primary defect and its regression guard are both landed. The ONE residue not done: the observation also suggested 'Folding both onto one shared constant (or pointing FOLDERS_FOR_TYPE at the same source) would prevent the two from desyncing again.' That did NOT happen — advance.ts:426 `FOLDERS_FOR_TYPE` and item-path.ts:34-41 `APPLY_LIFECYCLE_FOLDERS` are still two SEPARATE definitions, kept in step only by hand + a doc comment, so the drift the observation warned about can recur.

_Suggested default: Delete the observation as discharged (the reported mis-route is fixed and regression-tested). If the human wants the two folder-set constants unified to prevent future drift, mint a SEPARATE small task for that hardening rather than keeping this observation open, since this observation's titled defect is resolved._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
