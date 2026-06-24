---
title: Disable git rename detection on the runner's continue/integration rebase
slug: disable-rename-detection-on-continue-rebase
blockedBy: [] # startable now
covers: [] # self-contained chore; no prd
---

## What to build

Stop the runner's own continue/integration rebases from misreading a single
durable work/ folder-transition `git mv` as a whole-DIRECTORY rename. When a kept
work branch carries a folder transition out of a SPARSE source folder, git's
rename-detection heuristic infers a directory rename, and a later rebase onto a
main that ADDED files into that same folder flags each new file as a SPURIOUS
`CONFLICT (file location)` — even though no content conflicts. The runner then
(correctly, given no way to tell a spurious from a real conflict) aborts and
stuck-locks the branch, producing a FALSE needs-attention.

The slice: pass rename-detection-OFF to every rebase invocation on the runner's
continue/integration path (the `-Xno-renames` rebase strategy option, or the
equivalent `merge.renames=false` / `diff.renames=false` config SCOPED to that one
rebase invocation via `-c`). Scope it to the runner's own rebases ONLY; do not
touch the repo's persistent git config, so a user's interactive `git rebase` is
unaffected. The end-to-end behaviour to demonstrate: a done-move that empties a
sparse folder, then a continue-rebase onto a main that added files into that
folder, replays CLEANLY and the new files land where intended; a GENUINE same-path
content conflict still conflicts and still routes to needs-attention.

### Background: the exact failure shape (folded from the source observation)

Spotted 2026-06-19 while recovering `sweep-dead-surface-commit-path-after-lock-cutover`
(it bounced twice in CI `advance-lifecycle`; the second failure was not a red gate
but `rebase onto the latest main conflicted`).

A work branch carried its own durable done-move
`git mv work/backlog/<slug>.md -> work/done/<slug>.md`, made when `work/backlog/`
held essentially only that one item. Git's RENAME DETECTION then inferred a
whole-DIRECTORY rename `work/backlog/ -> work/done/` for that commit. When the
runner later continued the kept branch by rebasing it onto a `main` that had ADDED
new files into `work/backlog/` (sibling slices), git applied the inferred directory
rename and flagged each new file as
`CONFLICT (file location): ... added in HEAD inside a directory that was renamed ...
suggesting it should perhaps be moved to work/done/<slug>.md`.

The conflict was SPURIOUS: the added files were byte-identical to main's and the
sweep branch never touched them. The runner did the right thing (abort, never
auto-resolve, mark the lock stuck) because a directory-rename conflict is
indistinguishable from a real one without judgement. It was recovered via
`requeue --reset` (discard the stale branch; the code sweep regenerates cleanly off
current main, where the source folder is no longer sparse so the whole-dir-rename
heuristic no longer fires).

This bites ANY branch carrying a durable folder transition
(`tasks/todo → tasks/done`, `prds/ready → prds/tasked`,
`tasks/todo → tasks/cancelled`, `prds/ready → prds/dropped`) WHEN the SOURCE
folder is sparse (0-1 items) at branch time AND `main` later adds files into that
same folder. It is a latent FALSE needs-attention source. The taxonomy reorg makes
it MORE likely, not less: more folders, several often holding 0-1 files
(`tasks/cancelled/`, `prds/dropped/`, `prds/proposed/`).

### Approach decision: rename-off, NOT a per-folder sentinel (maintainer, 2026-06-20)

The maintainer DECIDED the fix is to disable rename detection on the runner's
continue-rebase (`-Xno-renames` / scoped `merge.renames=false`), and explicitly
REJECTED the per-folder sentinel alternative (a `README.md` / `.gitkeep` in each
work/ folder to keep it non-empty). Rationale to record in the done record / an ADR
if it meets the ADR gate: the sentinel scheme would FIGHT the case where a user
prefers genuinely-empty/deleted folders, whereas rename-off handles that case too.
A sentinel also adds a non-`*.md` companion file every item-scan predicate would
have to learn to exclude. Do NOT adopt the sentinel route in this task.

## Acceptance criteria

- [ ] The runner's continue/integration rebase disables git rename detection
      (`-Xno-renames`, or a scoped `merge.renames=false`/`diff.renames=false` via
      `-c` on the rebase invocation), so a single durable folder-transition `git mv`
      out of a sparse folder is NOT read as a whole-directory rename. Every rebase
      invocation on the continue/integration path carries it (including the
      stale-lease re-rebase retries and the integrate-tail rebase), NOT just one.
- [ ] Rename-off is SCOPED to the runner's own rebase invocations; the repo's
      persistent git config is NOT modified, so a user's interactive git is
      unaffected (assert/structure the change so the global/repo config stays clean).
- [ ] A regression test reproduces the original failure shape: a work branch that
      done-moves the SOLE item out of a sparse work/ folder, then a continue-rebase
      onto a main that ADDED new files into that same folder, and asserts the rebase
      now applies CLEANLY (no spurious `CONFLICT (file location)`), with the new
      files landing in their intended folder.
- [ ] A GENUINE content conflict on the same path still conflicts and still routes
      to needs-attention: rename-off must NOT mask real clashes. Assert a real
      same-path content conflict still aborts the rebase (the existing
      `{kind: 'conflict'}` / `rebase-conflict` route is preserved).
- [ ] The sentinel (README/.gitkeep) alternative is explicitly NOT adopted; the
      task/done record states WHY (it would break the user-prefers-empty-folders
      case, and adds a non-item companion file the item-scan must exclude).
- [ ] Tests use throwaway git repos + a local `--bare` `file://` arbiter; nothing
      writes outside its own temp fixtures (mirror the existing
      `makeScratch`/`seedRepoWithArbiter` helper style).

## Blocked by

- None — can start immediately.

## Prompt

> Disable git RENAME DETECTION on the runner's own continue/integration rebases so a
> single durable work/ folder-transition `git mv` out of a SPARSE source folder is
> never misread as a whole-DIRECTORY rename — which currently turns a clean
> continue-rebase (onto a main that added files into that same folder) into a
> spurious `CONFLICT (file location)`, making the runner abort and stuck-lock the
> branch as a FALSE needs-attention. Read the "What to build" and "Background"
> sections above for the full failure shape; they are self-contained.
>
> Domain vocabulary: a "continue"/"continued branch" is a KEPT `work/<slug>` branch
> from a prior attempt that the runner re-bases onto the freshly-fetched main before
> the agent builds on it (rebase-or-abort, never auto-resolve → conflict routes to
> needs-attention). A "folder transition" / "done-move" is a durable
> `git mv work/<from>/<slug>.md → work/<to>/<slug>.md` carried on the work branch.
>
> Where to look (by module/concept, not brittle line numbers):
>   - The continue machinery is the continue-branch module
>     (`packages/agent-runner/src/continue-branch.ts`): the helper that rebases the
>     currently-checked-out continued `work/<slug>` branch onto the fetched main, and
>     the stale-lease push retry loop that RE-rebases on each retry. BOTH run `git
>     rebase`; both need rename-off.
>   - The shared integrate band is the integration-core module
>     (`packages/agent-runner/src/integration-core.ts`): the rebase-to-integrate tail
>     rebases the work branch onto `<arbiter>/main`. That rebase (and any re-rebase in
>     its Race-1 merge-push retry loop) is the SAME kept-branch-onto-latest-main
>     replay and needs rename-off too. Note the band already has a sibling-slug
>     ledger reconcile and a divergent-done-move recovery arm — your change must NOT
>     widen or disturb those; it only adds the rename-off option to the rebase
>     invocation(s).
>   - Locate EVERY rebase invocation on the continue/integration path (search the two
>     modules above for `'rebase'` git args) and pass rename-detection-off, scoped to
>     each invocation. The git rebases here go through the soft/hard git runners
>     (`gitSoft`/`gitHard`); add `-Xno-renames` to the rebase args, or front the
>     rebase with `-c merge.renames=false` (scoped via `-c`, NEVER a persistent
>     `git config` write). Do NOT set rename-off globally for the repo's git config.
>
> Seams to test at: the `rebaseContinuedBranchOntoMain` helper is directly unit-
> testable with throwaway repos + a local bare arbiter (see
> `packages/agent-runner/test/continue-branch.test.ts` and its
> `makeScratch`/`seedRepoWithArbiter`/`gitIn`/`gitEnv` helpers). Build the regression
> at that seam (and/or the integrate-tail seam if more natural): construct a sparse
> source folder with one item, commit a `git mv` of that sole item to a target
> folder on a work branch, advance main with new files added into the SAME source
> folder, then rebase the work branch onto main and assert it is CLEAN with the new
> files in their intended folder. Add a second test where main and the branch make a
> GENUINE conflicting change to the SAME file's content and assert the rebase still
> conflicts (the `{kind: 'conflict'}` / needs-attention route is preserved) — proving
> rename-off does not mask real clashes.
>
> "Done" means: the runner's continue/integration rebase no longer infers a directory
> rename from a sparse-folder single `git mv`; the regression test reproduces the old
> failure and now passes clean; a genuine same-path content conflict still routes to
> needs-attention; the repo's persistent git config is untouched; and the sentinel
> alternative is explicitly rejected in the done record (it would break the
> user-prefers-empty-folders case). Verify with `pnpm -r build && pnpm -r test &&
> pnpm format:check`.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have
> DRIFTED): does the continue/integration rebase still live where described, and is
> rename detection still ON (default) there? If a prior slice already disabled it, or
> the rebase machinery moved, do NOT build on the stale premise — route the task to
> needs-attention with the discrepancy as the reason.
>
> RECORD non-obvious in-scope decisions you make while building (e.g. `-Xno-renames`
> vs scoped `-c merge.renames=false`, or which exact invocations you touch). If a
> choice meets the ADR gate (hard to reverse + surprising without context + a real
> trade-off — see `docs/adr/` and `ADR-FORMAT.md`), write the durable WHY as an ADR;
> otherwise note it briefly in the done record / PR description. The
> rename-off-over-sentinel decision (maintainer, 2026-06-20) is a strong ADR
> candidate.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim disable-rename-detection-on-continue-rebase --arbiter <remote>
# then start work on the updated main:
git fetch <remote> && git switch -c work/disable-rename-detection-on-continue-rebase <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/todo/disable-rename-detection-on-continue-rebase.md work/tasks/done/disable-rename-detection-on-continue-rebase.md
```
