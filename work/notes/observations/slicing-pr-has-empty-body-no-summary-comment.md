---
title: The slicing path opens a PR with an EMPTY body (no summary of what was sliced); build path threads a body but slicing does not
date: 2026-06-21
status: open
needsAnswers: false
---

## What was spotted

PR #188 (the runner auto-slicing the `prompt-guidance-test-first` brief into 3 tasks) opened with an **empty PR body**. The slicing itself was good (keystone + 2 thin dependents, coverage mapped, an honest `needsAnswers` on the deferred seam, Gate-2 self-review nits parked as an observation), but a human (or the conductor's Gate-3 diff review) landing on the PR gets NO summary of what was produced: which tasks, the coverage, the dependency shape, the deferred questions.

## Why (the asymmetry in the code)

The slicing path and the build path BOTH integrate through the shared core (`performIntegration`), but only the BUILD path supplies a PR body:

- **Build path:** threads `body: agent.output` (the build agent's FINAL SUMMARY) into the propose-mode PR description (`packages/agent-runner/src/do.ts:1095` and `:2205`; "Half B (propose-mode PR body)").
- **Slicing path** (`packages/agent-runner/src/slicing.ts`): integrates through `performIntegration` but passes NO equivalent body, so the PR degrades to `gh ... --fill` / empty (`github.ts`: "Absent body => degrades to gh pr create --fill").

So the gap is specific: the slicer never captures-and-threads a "here is what I sliced" summary the way the builder threads its final summary.

## Suggested fix (for triage)

On the slicing path, compose a PR body (or a posted PR comment) summarising the slice set: the produced task slugs + titles, the coverage map (which brief user stories each covers), the dependency graph (keystone + blockedBy), and any `needsAnswers` carried. The slicer already produces all of this; it just is not surfaced to the PR. Mirror the build path's `body: <summary>` threading, or post it as a `gh pr comment` (the review-gate PR-comment poster `github.ts` already exists and could be reused).

Relatedly: the build path's Gate-2 review posts a deliberate `review` PROSE comment on the PR (`review-gate.ts`, the `review` field; slice `review-comment-prose-field`). The slicing path's Gate (the slice-set acceptance gate, `buildSliceAcceptancePrompt`) ALSO emits a `review` prose field. Confirm whether that prose is being posted as a PR comment on slice PRs, or is currently dropped. If dropped, that is the same gap from the review angle.

## Provenance

Spotted by the user reviewing PR #188 during the v1.0.0-skills-alignment session (2026-06-21). Investigation confirmed the build-vs-slicing body asymmetry in `do.ts` vs `slicing.ts`.

## Applied answers 2026-06-22

### q1: How should this observation be triaged — promote it to a slice that threads a PR body / posts a PR comment on the slicing path, keep it as an open observation, or route it elsewhere?

promote-slice. Verified asymmetry: the build path threads `body: agent.output` into `performIntegration` (do.ts:1095, :2205) but the slicing path's `performIntegration` call (slicing.ts) passes no `body`, so slice PRs degrade to `gh pr create --fill` and land empty. The slicer already has the material (slugs/titles/coverage/dep-graph) to compose a summary. Fix is well-localised: add a composed summary as `body` in the slicing.ts `performIntegration` call. Disposition: promote-slice.

### q2: Is the slice-set acceptance gate's `review` prose field currently posted as a PR comment on slice PRs, or is it being silently dropped — and should that be folded into the same slice as the empty-body fix?

Already POSTED, not dropped — so this does NOT expand the empty-body slice's scope. The Gate-2 review-comment poster lives in the SHARED `performIntegration` core (gated on `approvedVerdict?.review !== undefined`), which the slicing path rides with review wired, so the comment posts automatically for both build and slicing callers (no per-caller wiring). Caveat: posting requires review ON, propose mode (a PR exists), and the verdict actually carrying a `review` field. The PR-body gap (Q1) is independent of and orthogonal to this comment path, so keep the empty-body fix narrow (body threading only).
