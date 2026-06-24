<!-- dorfl-sidecar: item=observation:needs-attention-test-cleanup-enotempty-flake type=observation slug=needs-attention-test-cleanup-enotempty-flake allAnswered=false -->

## Q1

**This observation already carries an applied answer of `promote-slice` (fix the cleanup race in the test-repo helper), but no follow-up task/brief appears to exist in `work/tasks/` or `work/briefs/` and the observation still sits in `work/notes/observations/` with `needsAnswers: false`. How should it now be discharged: (a) promote-task — author a small slice that makes `cleanup()` in `test/helpers/gitRepo.ts` await in-flight git/fs ops and/or retry `rmSync` on ENOTEMPTY (updating the stale `:102` reference — the real `rmSync` is at `:150`); (b) keep — leave as a live signal until the flake recurs; or (c) delete/dropped — judge it too low-signal to act on?**

> File: work/notes/observations/needs-attention-test-cleanup-enotempty-flake.md.
>
> Original signal (2026-06-18): intermittent failure of `test/needs-attention.test.ts > readNeedsAttentionItems lists the stuck items with their reason` under full `pnpm -r test` with `Error: ENOTEMPTY: directory not empty, rmdir '/tmp/dorfl-needs-attention-…/project'` from `cleanup()` in `test/helpers/gitRepo.ts`. Re-running the file in isolation passes. Diagnosed as a cleanup race between in-flight git/fs ops and `rmSync(root, {recursive:true, force:true})`, not a correctness issue.
>
> Applied-answers block (2026-06-22) records the decision verbatim as `promote-slice (small, localised)` and notes the cited line number is stale (`:102` → actually `:150`). However: (i) `promote-slice` is NOT one of the protocol's allowed dispositions (`promote-task | promote-adr | keep | delete | dropped | needs-attention`) — `promote-task` is the closest match; (ii) `needsAnswers:` in the frontmatter is `false`, so the engine will not re-surface it; (iii) no matching task/brief exists in `work/tasks/` or `work/briefs/` (grep for `enotempty`/`gitRepo.ts`/`test-cleanup` finds none). So the item is in an in-between state: judged but not routed, and not eligible for re-surfacing without this re-triage.

_Suggested default: promote-task — author a small slice in `work/tasks/` to (a) await in-flight git/fs ops before `cleanup()` and/or retry `rmSync` on ENOTEMPTY in `test/helpers/gitRepo.ts` (currently the `rmSync` call is at `:150`, not `:102`), and (b) delete this observation once the slice is queued. Matches the human's already-applied intent (`promote-slice`) translated to the protocol's vocabulary._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):
