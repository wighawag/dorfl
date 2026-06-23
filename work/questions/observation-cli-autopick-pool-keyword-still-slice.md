<!-- agent-runner-sidecar: item=observation:cli-autopick-pool-keyword-still-slice type=observation slug=cli-autopick-pool-keyword-still-slice allAnswered=false -->

## Q1

**Rename the user-facing auto-pick POOL keyword `slice` in the `do`/`advance` help text (and any operator parsing that accepts it) to match the renamed rung vocabulary — what is the new keyword, and is the change clean-break or do we accept the old `slice` spelling as an alias for one release?**

> `packages/agent-runner/src/cli.ts` describes the auto-pick pool list as `build/slice/surface/triage` in two help strings — L1857 (`do --selection-order`) and L2387 (`advance --selection-order`), with the example `build,slice,surface,triage`. The advance rung TOKEN was renamed by `work/tasks/done/rename-advance-rung-and-sliced-outcome-tokens.md` from `'build-slice'`→`'build-task'` and `'slice-prd'`→`'task-brief'` (verb-noun: build a task / task a brief), and the prior `code-identifier-slice-prd-to-task-brief-rename` brief was explicitly a clean break. The pool-keyword `slice` (= the brief-tasking pool) is the surviving residue of that old vocabulary on the operator-facing surface. Open question because (a) the keyword shape is not 1:1 with the rung token (`build`/`surface`/`triage` are already short forms, not the full `build-task`/`surface`/`triage-observation`), so the replacement could be `task`, `task-brief`, `brief`, or `tasking`, and (b) the same code path likely parses the comma-separated form, so any rename affects per-repo `selectionOrder` configs and env values already in the wild.

_Suggested default: Rename `slice` → `task` (keeping the short-form style of `build`/`surface`/`triage`; matches `build-task`/`task-brief` rungs as the brief-tasking pool), clean break with NO alias — consistent with the original rename's clean-break stance. Update both help strings + the parser + any test fixtures, and grep per-repo `.agent-runner.json`s in this repo for stale `selectionOrder` values._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):
