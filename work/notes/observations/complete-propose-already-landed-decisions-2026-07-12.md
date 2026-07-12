# Decisions — complete-propose-honour-already-landed-and-rename-continue-branch-module

Date: 2026-07-12

Durable record of the non-obvious choices for this task (linked from the done body). Continues a prior attempt that had already implemented the two in-scope changes; this pass reviewed that work, kept it, and repaired the gate.

## 1. `complete.ts` alreadyLanded branch — surface the integrator instruction verbatim

When `IntegrateResult.alreadyLanded === true`, `complete.ts` now short-circuits BEFORE `formatProposeNextStep` and emits `result.instruction` VERBATIM (with a small trailing switch/delete tail), rather than the generic push+PR next-step block. Chosen over wrapping/rephrasing the instruction because the integrator already owns the correct clean-no-op prose and the CI-dominant recovery path (`performIntegration`) surfaces the same text, so verbatim keeps the two sibling callers consistent. Touches only the `complete --propose` next-step + summary text; the switch-to-main / delete-local-branch / `--no-switch` tail is unchanged, and the structured `CompleteResult` keeps `mergedToMain: false`. A defensive fallback string is used if `instruction` is somehow absent.

## 2. `continue-branch.ts` — scope-note, not rename

The file hosts both `pushContinuedBranchWithStaleLeaseRetry` (original continue/onboard caller) and `pushProposeBranchWithStaleLeaseRetry` (propose integrator). Chose the top-of-file broadened-scope doc comment over renaming to `stale-lease-work-push.ts`. Rationale: the task asked for whichever is the smaller, less-churny honest change; a rename would touch many `src/` + `test/` imports for no behavioural gain, and the module already reads as one conceptual bucket. Touches nothing outside the file.

## 3. Removed the prior attempt's stale observation note (gate repair)

The prior attempt left `work/notes/observations/prd-leak-scan-red-on-main-from-hard-cutover-task-body.md`, whose premise (that `prd-word-cutover-leak-scan` is red on `origin/main` because of a `hard-cutover-...` ready body) is FALSE for the current `origin/main` (`0e3b11c2`): that ready body no longer exists there and the leak-scan is green on main (verified in a throwaway worktree). Worse, the note itself introduced the ONLY current red gate — it wrote the standalone artifact-word (unbackticked) in prose under `work/notes/`, which the leak-scan flags. Deleting the note restores a green `pnpm -r test`. This note records the same signal correctly and keeps the retired word inside `` `code` `` spans so the scan does not flag it.
