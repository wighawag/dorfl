> **RE-SCOPED 2026-07-11 (ready-pool analysis).** This task was authored before the `slicing`→`tasking` cutover. `slicing.ts` no longer exists (it is `tasking.ts`), and the domain vocabulary is `task`/`spec`, not `slice`/`brief`. The underlying bug is STILL LIVE: verified on main 2026-07-11 that the tasking `performIntegration` call at `packages/dorfl/src/tasking.ts:634` passes NO `body`, so a tasking PR degrades to `gh pr create --fill` and lands with an empty body. Pointers below are corrected to current reality.

## Context

The TASKING path (`do spec:<slug>`) and the build path both integrate through the shared `performIntegration` core, but only the BUILD path threads a PR body. Result: tasking PRs land with an EMPTY body — `gh pr create --fill` degradation — so a human (or Gate-3 diff review) sees no summary of what was tasked: task slugs/titles, coverage map, dependency shape, or carried `needsAnswers`.

Asymmetry confirmed in code (verified 2026-07-11):

- Build path threads `body: agent.output` (the build agent's FINAL SUMMARY) into propose-mode PR creation at `packages/dorfl/src/do.ts:1192` and `:2349` ("Half B (propose-mode PR body)").
- Tasking path (`packages/dorfl/src/tasking.ts`) calls `performIntegration` at `:634` but passes NO `body`, so `github.ts` degrades to the bare `--fill` when both title/body are absent (see `github.ts` ~L176/L455).

The tasker already produces everything needed for the summary; it just is not surfaced to the PR.

## Scope (narrow)

Compose a task-set summary in `tasking.ts` and thread it as `body` on that file's `performIntegration` call (`:634`), mirroring the build path's `body: agent.output` threading.

The summary SHOULD include, drawn from material the tasker already has in hand:

- The produced task slugs + titles.
- The coverage map (which spec user stories / acceptance points each task covers).
- The dependency graph (keystone + `blockedBy` edges).
- Any `needsAnswers` carried on the minted tasks (so deferred seams are visible on the PR).

Mirror the build path's shape: a single composed string threaded as `body` into `performIntegration`; no new plumbing in the shared core, no new fields on the integration API beyond what the build path already uses.

## Out of scope

- The task-set acceptance gate's `review` prose field is ALREADY posted as a PR comment via the shared `performIntegration` review-comment poster (gated on `approvedVerdict?.review !== undefined`); the tasking path rides that automatically. Do NOT re-plumb or duplicate the review-comment path. This task is body-threading only.
- No changes to `do.ts` build-path body threading.
- No changes to `github.ts` fallback behaviour (the `--fill` degradation stays as the absent-body fallback; this task just stops the slicing path from hitting it).

## Acceptance

- `tasking.ts`'s `performIntegration` call (`:634`) passes a non-empty `body` composed from the task-set (slugs+titles, coverage, dep graph, carried `needsAnswers`).
- A test exercises the tasking path and asserts the composed body is threaded through (contains task slugs, coverage, dep info, and any `needsAnswers`) rather than dropped.
- The existing build-path body threading is unchanged.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Pointers

- Build-path reference: `packages/dorfl/src/do.ts:1192`, `:2349` (Half B propose-mode PR body).
- Tasking-path site to change: `packages/dorfl/src/tasking.ts:634` (its `performIntegration` call).
- Fallback behaviour to avoid: `packages/dorfl/src/github.ts` (the bare `--fill` when title/body are both absent, ~L176/L455).

## Provenance

Promoted from observation `slicing-pr-has-empty-body-no-summary-comment` (spotted 2026-06-21 on PR #188). Re-scoped 2026-07-11 onto the post-cutover `tasking.ts` + task/spec vocabulary; the bug it describes was re-verified live at that time.

## Prompt

> Build the task 'slicing-pr-body-summary-threading', described above (note the RE-SCOPED banner: the target file is `tasking.ts`, not the retired `slicing.ts`, and the vocabulary is task/spec).
