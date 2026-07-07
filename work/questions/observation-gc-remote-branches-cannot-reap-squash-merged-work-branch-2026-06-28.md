<!-- dorfl-sidecar: item=observation:gc-remote-branches-cannot-reap-squash-merged-work-branch-2026-06-28 type=observation slug=gc-remote-branches-cannot-reap-squash-merged-work-branch-2026-06-28 allAnswered=false -->

## Q1

**What should become of this observation — mint a task to make the reaper squash-aware (per the suggested fix), fold it into the lock-side twin observation's disposition, or drop it as accepted-known?**

> Observation is verified against current code: packages/dorfl/src/reap-branches.ts and gc.ts still gate 'provably merged' solely on 'git merge-base --is-ancestor <tip> <arbiter>/main' (grep confirms, no squash/cherry/patch-id fallback). Concrete incident: origin/work/task-reaper-no-lock-outcome-benign-not-lost survived every gc --remote-branches tick after PR #186 squash-landed, needed a manual push --delete on 2026-06-28. Impact: any repo defaulting to squash-merge accumulates one orphan work/<slug> remote branch per landed item forever, defeating the reaper's stated purpose. Suggested fix shape already drafted in the note: keep --is-ancestor as fast path, add a squash-aware fallback (terminal-on-main record + git diff <main> <tip> empty, or git cherry equivalence), with tests pinning both 'squash-landed => reaped' and 'genuinely unmerged => retained'. Related: sibling lock-side twin observation reaper-never-clears-a-done-plus-stuck-lock-orphans-forever-2026-06-20; no task in work/tasks/{ready,queued,done} currently addresses squash-aware reaping (nearest, reap-merged-remote-work-branches, is the ancestry-only sweep this observation critiques). GitHub's delete_branch_on_merge covers only GitHub arbiters, not bare/non-GitHub, so the provider-agnostic sweep must handle squash itself.

_Suggested default: Mint a task 'reap-squash-merged-remote-work-branches' implementing the terminal-on-main + content-subset (or git cherry) fallback with the two pin tests, and cross-link to the lock-side twin observation._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
