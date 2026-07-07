## Context

The slicing path and the build path both integrate through the shared `performIntegration` core, but only the BUILD path threads a PR body. Result: slice PRs (e.g. PR #188, the auto-slicing of `prompt-guidance-test-first` into 3 tasks) land with an EMPTY body — `gh pr create --fill` degradation — so a human (or Gate-3 diff review) sees no summary of what was sliced: task slugs/titles, coverage map, dependency shape, or carried `needsAnswers`.

Asymmetry confirmed in code:

- Build path threads `body: agent.output` (the build agent's FINAL SUMMARY) into propose-mode PR creation at `packages/dorfl/src/do.ts:1095` and `:2205` ("Half B (propose-mode PR body)").
- Slicing path (`packages/dorfl/src/slicing.ts`) calls `performIntegration` but passes NO `body`, so `github.ts` degrades to `gh pr create --fill` ("Absent body => degrades to gh pr create --fill").

The slicer already produces everything needed for the summary; it just is not surfaced to the PR.

## Scope (narrow)

Compose a slice-set summary in `slicing.ts` and thread it as `body` on that file's `performIntegration` call, mirroring the build path's `body: agent.output` threading.

The summary SHOULD include, drawn from material the slicer already has in hand:

- The produced task slugs + titles.
- The coverage map (which brief user stories / acceptance points each task covers).
- The dependency graph (keystone + `blockedBy` edges).
- Any `needsAnswers` carried on the minted tasks (so deferred seams are visible on the PR).

Mirror the build path's shape: a single composed string threaded as `body` into `performIntegration`; no new plumbing in the shared core, no new fields on the integration API beyond what the build path already uses.

## Out of scope

- The slice-set acceptance gate's `review` prose field is ALREADY posted as a PR comment via the shared `performIntegration` review-comment poster (gated on `approvedVerdict?.review !== undefined`); the slicing path rides that automatically. Do NOT re-plumb or duplicate the review-comment path. This task is body-threading only.
- No changes to `do.ts` build-path body threading.
- No changes to `github.ts` fallback behaviour (the `--fill` degradation stays as the absent-body fallback; this task just stops the slicing path from hitting it).

## Acceptance

- `slicing.ts`'s `performIntegration` call passes a non-empty `body` composed from the slice-set (slugs+titles, coverage, dep graph, carried `needsAnswers`).
- A test exercises the slicing path and asserts the composed body is threaded through (contains task slugs, coverage, dep info, and any `needsAnswers`) rather than dropped.
- The existing build-path body threading is unchanged.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Pointers

- Build-path reference: `packages/dorfl/src/do.ts:1095`, `:2205` (Half B propose-mode PR body).
- Slicing-path site to change: `packages/dorfl/src/slicing.ts` (its `performIntegration` call).
- Fallback behaviour to avoid: `packages/dorfl/src/github.ts` ("Absent body => degrades to gh pr create --fill").

## Provenance

Promoted from observation `slicing-pr-has-empty-body-no-summary-comment` (spotted 2026-06-21 on PR #188 during the v1.0.0-skills-alignment session; triage resolved 2026-06-22 to promote-slice, then hard-cut to a task per the repo's slice->task convention). The observation and its sidecar are being deleted in the same revertible commit that mints this task, so the resolved signal cannot re-fire.
