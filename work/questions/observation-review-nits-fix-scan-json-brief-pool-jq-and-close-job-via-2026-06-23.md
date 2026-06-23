<!-- agent-runner-sidecar: item=observation:review-nits-fix-scan-json-brief-pool-jq-and-close-job-via-2026-06-23 type=observation slug=review-nits-fix-scan-json-brief-pool-jq-and-close-job-via-2026-06-23 allAnswered=false -->

## Q1

**Nit 1 — workflow regen: the .briefs[] fix lives only in the SOURCE template (docs/ci/advance-loop.yml.template) and the emitters; .github/workflows/advance-lifecycle.yml lines 163-165, 215 still read .prds[] (correctly left untouched per the 'agents never touch workflow files' rule). Capability B stays silently dead on the cron until a human re-runs the documented `install-ci` step (`cp docs/ci/advance-loop.yml.template .github/workflows/...`). Promote to a tiny human-action task to schedule the workflow regen so the fix reaches production, KEEP as a standing reminder on this observation, or DELETE (treat install-ci as already-known human chore covered elsewhere)?**

> .github/workflows/advance-lifecycle.yml:215 still has `.repos[].prds[]?, .cwd.repo.prds[]?`; docs/ci/README.md documents the regen step; an `install-ci-tier1-branch-protection.md` task already exists under work/tasks/todo/ but is scoped to branch-protection, not the .briefs[] regen.

_Suggested default: promote-task — a 1-step human-action task 'regenerate .github/workflows/advance-lifecycle.yml from docs/ci/advance-loop.yml.template' so capability B actually lights up on the cron; nothing else in todo/ covers it._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):

## Q2

**Nit 2 — ratify the agent's edit of docs/ci/advance-loop.yml.template (the workflow SEED, not a .github/workflows/* file): the edit was necessary because advance-ci-template.test.ts:36-37,106 loads that exact template via loadAdvanceCiTemplate() and asserts /\.repos\[\]\.briefs\[\]\?/, so leaving it on .prds[] would have failed the gate. The 'where to edit' list named only the .ts emitters + tests and no Decisions block was in the commit. Accept as ratified (KEEP/DELETE the nit) or treat as a real process gap warranting a task (e.g. tighten 'where to edit' or require a Decisions block when seeds are touched)?**

> docs/ci/advance-loop.yml.template:193 changed to `.briefs[]`; advance-ci-template.ts:62-90 resolves+loads this exact path; gate is green — confirming the edit was required.

_Suggested default: delete — purely a ratification note for a justified, gate-forced edit on a seed (not a workflow file); no follow-up action needed._

<!-- q2 fields: id=q2 disposition=delete -->

**Your answer** (write below this line):

## Q3

**Nit 3 — ratify the agent's side-output observation `work/notes/observations/recursive-test-run-occasional-flake-2026-06-23.md` capturing a transient `pnpm -r test` flake. The bucket is correct (observation = spotted/unverified, append-only) and it self-scopes as 'not in this task'. It was simply not listed in a Decisions block. Accept as ratified (DELETE the nit) or keep as a standing signal?**

> The flake note self-identifies as out-of-task-scope and is an append-only observation — exactly what the observations bucket is for.

_Suggested default: delete — capturing a flake signal is the contract of the observations bucket; no action needed beyond noting it was correct._

<!-- q3 fields: id=q3 disposition=delete -->

**Your answer** (write below this line):

## Q4

**Nit 4 — residual stale PROSE in tests: scan.test.ts describe-block strings still say 'sliceable-PRD pool (`prds[]`)' (lines 416, 501) and close-job.test.ts test names still say 'closes the PRD issue when ALL its prd:<slug> slices' (lines 115, 140; fixtures named `my-prd`/`prd`). These are test-name/comment prose, not wire-key assertions, and the prose sweep is a SEPARATE set of tasks under the `code-identifier-slice-prd-to-task-brief-rename` brief. Confirm coverage by the existing prose-sweep brief (KEEP as a cross-ref pointer) or promote a dedicated mop-up task for these specific files if the prose-sweep brief doesn't already enumerate them?**

> Required behavioural assertions (`.via toBe('brief')` at close-job.test.ts:225-226 and `.briefs[]` regex assertions) were all updated; only descriptive prose lags. work/briefs/ already contains `code-identifier-slice-prd-to-task-brief-rename.md` covering the prose rename.

_Suggested default: keep — leave as a cross-reference reminder pointing the prose-sweep brief at these exact file/line locations; no new task unless the sweep brief is silent on them._

<!-- q4 fields: id=q4 disposition=keep -->

**Your answer** (write below this line):
