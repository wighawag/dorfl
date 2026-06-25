<!-- dorfl-sidecar: item=observation:scan-json-prds-key-vs-jq-path-possible-mismatch type=observation slug=scan-json-prds-key-vs-jq-path-possible-mismatch allAnswered=false -->

## Q1

**What should become of this observation? Its original feared defect (the emitted advance-CI `jq` reading a `.prds[]` key that `scan --json` does not emit) is NOT present in the current tree, but for a non-obvious reason worth a decision: the verified fix that renamed the key+legs `prds`->`briefs`/`prd:`->`brief:` was applied in commit 8e3fcb0, then SILENTLY REVERTED by the project-rename commit 67a19ca, which put everything back to `prds`. Pick one: (a) close/delete this observation as resolved-but-by-revert and mint a NEW task to re-apply the `prds`->`briefs` rename (re-fix the regression); (b) close/delete it as moot because `prds`/`prd:` is now the intended vocabulary again (the rename drive was abandoned) and no action is needed; or (c) something else.**

> Observation (work/notes/observations/scan-json-prds-key-vs-jq-path-possible-mismatch.md, needsAnswers: true, no `## Open questions` block) feared `scan --json` emits `briefs` while the emitted `jq` reads `.prds[]` -> propose matrix enumerates zero briefs (capability B silently dead).
>
> Current-tree reality (consistent, NO silent bug): scan.ts:160 `prds: ScannedPrd[]` (no `briefs`/`ScannedPrd` alias); advance-lifecycle-template.ts:314 and advance-ci-template.ts both read `.repos[].prds[]?` + `.cwd.repo.prds[]?` and emit `"prd:" + .slug`. `grep -c 'briefs[]'` = 0 in both emitters.
>
> History (the real finding): commit 8e3fcb0 (`fix-scan-json-brief-pool-jq-and-close-job-via`, now in work/tasks/done/) renamed `.prds[]`->`.briefs[]` and `prd:`->`brief:` in scan.ts + both templates + mirror-pool-scan.ts + tests, per brief `code-identifier-slice-prd-to-task-brief-rename`. The very next commit 67a19ca ("Rename project from agent-runner to dorfl", a packages/agent-runner -> packages/dorfl move+rewrite) re-introduced `prds`/`.prds[]`/`prd:` across scan.ts, both templates, and mirror-pool-scan.ts, undoing that fix. So the codebase silently regressed the `prd`->`brief` vocabulary cutover during the project rename.

_Suggested default: Option (a): the observation is no longer a live silent-CI-bug (key and jq agree), but the agreement was reached by reverting an intentional, verified `prds`->`briefs` rename during the dorfl project-rename commit 67a19ca. Mint a follow-up task to re-apply the `prds`->`briefs` / `prd:`->`brief:` rename (scan.ts `RepoReport.prds`->`briefs`/`ScannedPrd`->`ScannedBrief`, both emitter templates' `jq`+validators+comments, mirror-pool-scan.ts, and the matching tests) so the regression is corrected, then delete this observation. Verify against `code-identifier-slice-prd-to-task-brief-rename` to confirm `brief` is still the intended vocabulary before re-applying._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
