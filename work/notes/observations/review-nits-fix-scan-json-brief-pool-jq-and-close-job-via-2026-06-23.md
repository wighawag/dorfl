---
title: review-gate non-blocking nits for 'fix-scan-json-brief-pool-jq-and-close-job-via' (Gate 2 approve)
date: 2026-06-23
status: open
reviewOf: fix-scan-json-brief-pool-jq-and-close-job-via
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'fix-scan-json-brief-pool-jq-and-close-job-via' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- The headline 'REAL silent CI bug' is fixed in the SOURCE template (`docs/ci/advance-loop.yml.template`) and the emitters, but NOT in the live running workflow. `.github/workflows/advance-lifecycle.yml` (lines 163-165, 215) still reads `.prds[]` and was correctly left untouched per the task's scope fence ('agents never touch workflow files'). Per `docs/ci/README.md` the running workflow only picks up the `.briefs[]` fix once a human regenerates/recopies it (`cp docs/ci/advance-loop.yml.template .github/workflows/...`, the documented `install-ci` step). So capability B stays silently dead on the cron until that human step runs. Recommend the human schedule the workflow regen as the named follow-up so the fix actually reaches production.
  (.github/workflows/advance-lifecycle.yml:215 still has `.repos[].prds[]?, .cwd.repo.prds[]?`; task AC explicitly forbade editing `.github/workflows/*` (emitter source only). This is by-design, not a defect, but the bug is not live-fixed by this PR alone.)
- RATIFY: the agent edited `docs/ci/advance-loop.yml.template` (the workflow SEED), which the task's 'where to edit' list did not name (it named only the `.ts` emitters + tests). This was NECESSARY and correct: `advance-ci-template.test.ts:36-37,106` loads that real template via `loadAdvanceCiTemplate()` and asserts `/\.repos\[\]\.briefs\[\]\?/` against it, so leaving the `.yml.template` on `.prds[]` would have failed the (now-green) gate. It is a doc/source seed, NOT a `.github/workflows/*` file, so it does not violate the task's no-workflow-edit rule. No Decisions block was present in the commit body to record this; flagging for ratification only.
  (docs/ci/advance-loop.yml.template:193 changed to `.briefs[]`; advance-ci-template.ts:62-90 resolves+loads this exact path; the gate is green which confirms the edit was required.)
- RATIFY: the agent added `work/notes/observations/recursive-test-run-occasional-flake-2026-06-23.md` recording a transient `pnpm -r test` flake. Bucket is correct (observation = spotted/unverified, append-only) and it is honestly scoped ('not in this task's scope'). It is an in-scope capture-signal side-output, not scope creep. Flagging only because it was not listed in a Decisions block.
  (The note self-identifies as out of task scope and is a pure append to observations/.)
- Residual stale PROSE: `scan.test.ts` describe-block strings still say 'sliceable-PRD pool (`prds[]`)' (lines 416, 501) and `close-job.test.ts` test names still say 'closes the PRD issue when ALL its prd:<slug> slices' (lines 115, 140, 116-118 fixtures named `my-prd`/`prd`). These are test-name/comment PROSE, not wire-key assertions, and the prose sweep is a SEPARATE set of tasks under the same brief (`code-identifier-...rename`), so they are correctly out of THIS task's `'prd'`-literal scope. No action needed in this task; noting for the prose-sweep tasks' coverage.
  (The required behavioural assertions (the `.via` toBe('brief') at close-job.test.ts:225-226 and the `.briefs[]` regex assertions) were all updated; only descriptive prose lags.)
