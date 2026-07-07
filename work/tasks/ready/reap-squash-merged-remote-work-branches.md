## Problem

The remote-branch reaper (`packages/dorfl/src/reap-branches.ts`
`reapMergedRemoteWorkBranches`) and the shared merge-reap primitive
(`packages/dorfl/src/gc.ts` ~L23/L109/L437-452, also called from
`integrator.ts` L686/L766, `integration-core.ts` L1439, `complete.ts` L1323,
`isolation.ts` L405) decide "provably merged / safe to reap" using ONLY:

```
git merge-base --is-ancestor <branch-tip> <arbiter>/main
```

That predicate is TRUE for fast-forward / true-merge lands, but a **squash**
merge creates a brand-new commit on main with the branch tip as no ancestor.
So on any repo whose PRs land as squash-merges (a very common GitHub default,
and what this repo itself uses — e.g. PR #186), every landed `work/<slug>`
branch is orphaned on the remote FOREVER: `gc --remote-branches` runs and
reaps nothing, because by construction nothing squash-landed passes
`--is-ancestor`.

Concrete incident (2026-06-28): `origin/work/task-reaper-no-lock-outcome-benign-not-lost`
(tip `284853670bfa0e424f0233a31f131bb3d73d9697`) survived every scheduled gc
tick even though its work had landed on main as squash commit `2e025ae`, its
done record `work/tasks/done/reaper-no-lock-outcome-benign-not-lost.md` was
present on `origin/main`, and `git diff origin/main <tip>` showed the branch
carries NOTHING main lacks (it was just 120 files / ~58k lines behind a
since-advanced main). It had to be deleted manually.

This is the branch-side twin of
`reaper-never-clears-a-done-plus-stuck-lock-orphans-forever-2026-06-20` — same
shape: the durable `main` record says the item is terminal, but the
ancestry-only predicate cannot see it, so the orphan survives. Cross-link the
two in the disposition.

GitHub's `delete_branch_on_merge` repo setting (offered by `install-ci.ts`
L216-234 / `install-ci-github.ts`) covers the GitHub-hosted case, but the
provider-agnostic sweep is still the only floor for `--bare` / non-GitHub
arbiters, so the sweep itself must handle squash.

## Fix shape (decided)

Keep the cheap `--is-ancestor` fast-path. Add a **squash-aware fallback** that
is still grounded in the durable `main` record (which is authoritative) and
does NOT loosen the safety floor (never reap an in-flight / unmerged branch,
never `--force`):

A remote `work/<slug>` branch is reapable iff EITHER:

1. **Fast path (unchanged):** `git merge-base --is-ancestor <tip> <arbiter>/main`
   succeeds; OR
2. **Squash-aware fallback (new):** BOTH of the following hold:
   - the item is TERMINAL on `<arbiter>/main` — i.e. the matching
     `work/tasks/done/<slug>.md` or `work/tasks/dropped/<slug>.md` (or the
     equivalent for the item's type) exists on the fetched main tree; AND
   - the branch carries nothing main lacks — either `git diff <arbiter>/main
     <tip>` is empty (content-subset), OR `git cherry <arbiter>/main <tip>`
     reports every branch commit as already applied (`+`/`-` where every
     line is `-`, i.e. patch-id equivalence — this also catches rebase-lands).

Either of the two content checks is sufficient; prefer whichever is cheaper /
more robust in practice (likely `git diff --quiet` first, `git cherry` as the
rebase-catching backstop). The terminal-on-main check is the anchor that says
"the authoritative record already declares this item done/dropped, so its
branch has no in-flight work to protect."

Apply the same squash-aware predicate everywhere the ancestry-only test is
currently used to decide reap-safety: `reap-branches.ts`, `gc.ts`, and the
merge-reap callers in `integrator.ts`, `integration-core.ts`, `complete.ts`,
`isolation.ts` — extract a single shared `isProvablyMergedForReap(tip,
arbiterMain, slug)` helper so the two-step predicate lives in ONE place and
all call sites stay in sync.

## Pin tests (required)

At minimum, add tests that pin both directions of the new predicate:

- **(a) Squash-landed IS reaped.** Set up a throwaway repo with an arbiter
  `main` that contains the done record for `<slug>` and a squash commit
  reflecting the branch's content; the branch tip is NOT an ancestor of main.
  `gc --remote-branches` (or the equivalent unit-level call to the shared
  predicate) MUST reap `work/<slug>`.
- **(b) Genuinely unmerged is RETAINED.** A `work/<slug>` branch whose item
  has NO terminal record on main (still claimed / in-flight), or whose tip
  carries commits main lacks, MUST NOT be reaped — even if `--is-ancestor`
  fails. Cover both sub-cases (no-terminal-record; terminal-record-but-branch-
  has-extra-commits) so neither half of the fallback can silently drift into a
  data-loss reap.
- Bonus: **(c) Rebase-landed IS reaped** via the `git cherry` path (branch
  tip is not an ancestor and `diff` is non-empty, but every commit's patch-id
  is already on main).

## Acceptance

- Shared `isProvablyMergedForReap` helper exists and is the SOLE decision
  point for reap-safety across `reap-branches.ts`, `gc.ts`,
  `integrator.ts`, `integration-core.ts`, `complete.ts`, `isolation.ts`.
- All three pin tests above are green.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.
- No change to the safety floor: no `--force`, no reaping of branches whose
  item is not terminal on main, no reaping of branches carrying commits main
  lacks.

## Refs

- Sibling (lock-side twin, cross-link in this task's disposition):
  `reaper-never-clears-a-done-plus-stuck-lock-orphans-forever-2026-06-20`.
- Originating observation:
  `gc-remote-branches-cannot-reap-squash-merged-work-branch-2026-06-28`
  (delete on mint of this task).
- Incident: orphaned `origin/work/task-reaper-no-lock-outcome-benign-not-lost`
  from squash-merged PR #186, deleted manually 2026-06-28.
- GitHub-only convenience that does NOT cover bare arbiters:
  `delete_branch_on_merge` (`install-ci.ts` L216-234,
  `install-ci-github.ts`) — orthogonal; the provider-agnostic sweep must
  still handle squash itself.

## Prompt

> Build the task 'reap-squash-merged-remote-work-branches', described above.
