<!-- dorfl-sidecar: item=observation:review-nits-install-ci-tier1-branch-protection-2026-06-26 type=observation slug=review-nits-install-ci-tier1-branch-protection-2026-06-26 allAnswered=false -->

## Q1

**This observation records three non-blocking nits from the Gate-2 approve of 'install-ci-tier1-branch-protection' (now done at commit 38368f6b): (a) ratify the six in-scope choices made silently without a 'Decisions' block in the PR/commit (scope detection via permissions.admin, branch-protection PUT vs ruleset POST, deadlock-guard chosen as natural-trigger + log line, undefined admin = non-admin, verify capability auto-emitted on every install-ci, step 5b unconditional); (b) DEFAULT_PROTECTED_BRANCH is hardcoded to 'main' with no default-branch auto-detect, so repos on 'master' (or any non-'main' default) get protection PUT on the wrong/non-existent branch and the printed gh-api fallback is also wrong; (c) the deadlock guard is documentation-shaped (a NOTE log line + relying on the user to push verify.yml) rather than mechanism-shaped (pre-run the check, or ruleset do_not_enforce_on_create) — the brief had asked to 'pick one and justify' and the agent picked neither runtime mechanism. What becomes of this signal: delete it (decisions are recorded in source comments and that is good enough, hardcoded 'main' is acceptable for now, doc-shaped deadlock guard is the intended trade-off), promote the (b) default-branch auto-detect to a task, promote the (c) ruleset/pre-run mechanism to a task or PRD, and/or keep it open pending ratification of (a)?**

> work/notes/observations/review-nits-install-ci-tier1-branch-protection-2026-06-26.md (status: open). Task is landed: work/tasks/done/install-ci-tier1-branch-protection.md, commit 38368f6b — title only, no 'Decisions' block. Code today:
>  - packages/dorfl/src/install-ci-branch-protection.ts: `DEFAULT_PROTECTED_BRANCH = 'main'`, module-header §DEADLOCK GUARD describes the doc-shaped choice.
>  - packages/dorfl/src/install-ci.ts step 5b calls installCIBranchProtectionStep({ctx,fake,log}) unconditionally, no branch arg.
>  - packages/dorfl/src/install-ci-github.ts has no `gh repo view --json defaultBranchRef` lookup.
>  Triage prompt at the bottom of the observation: 'promote-to-task / keep / delete.' (a) is pure ratification (no code change); (b) and (c) are real code residue against current reality — (b) would 404 / mis-target on any non-'main' repo today, (c) leaves a real 'set protection then forget to push verify.yml' deadlock window for in-flight PRs.

_Suggested default: Split the answer per nit: (a) ratify in your reply (the choices are reasonable and now durably named) and delete that strand; (b) promote a small task — 'install-ci: auto-detect default branch via gh repo view --json defaultBranchRef, pass it through to PUT + the printed fallback, fall back to main only if the lookup fails' — because non-'main' repos break silently today; (c) promote a follow-up task — 'install-ci branch-protection: use ruleset do_not_enforce_on_create (or pre-run verify once) so the deadlock guard is mechanism-shaped, not a log line' — since the brief explicitly asked for a runtime mechanism and the doc-shaped choice leaves a real window. Then delete the observation once (b) and (c) are minted._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
