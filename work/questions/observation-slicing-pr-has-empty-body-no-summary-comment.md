<!-- agent-runner-sidecar: item=observation:slicing-pr-has-empty-body-no-summary-comment type=observation slug=slicing-pr-has-empty-body-no-summary-comment allAnswered=false -->

## Q1

**How should this observation be triaged — promote it to a slice that threads a PR body / posts a PR comment on the slicing path, keep it as an open observation, or route it elsewhere?**

> The observation documents a concrete asymmetry: the build path threads `body: agent.output` into `performIntegration` (do.ts:1095, :2205) but the slicing path (slicing.ts) calls the same integrator with no body, so slicing PRs (e.g. #188) degrade to `gh pr create --fill` and land empty. The slicer already has all the material (task slugs+titles, coverage map, dep graph, carried needsAnswers) — it just is not surfaced. A fix is well-scoped: mirror the build-path body threading, or reuse the existing `github.ts` PR-comment poster. This looks like a small, ready-to-slice fix rather than an architectural question.

_Suggested default: promote-slice — small, well-localised fix with an obvious shape (compose summary in slicing.ts, thread as PR body or post as PR comment)_

<!-- q1 fields: id=q1 disposition=promote-slice -->

**Your answer** (write below this line):

## Q2

**Is the slice-set acceptance gate's `review` prose field currently posted as a PR comment on slice PRs, or is it being silently dropped — and should that be folded into the same slice as the empty-body fix?**

> The observation flags a related unknown: `buildSliceAcceptancePrompt` emits a `review` prose field (mirroring the build path's Gate-2 review, which IS posted on the PR per `review-gate.ts` and the `review-comment-prose-field` slice). The author did not verify whether the slicing-side `review` prose actually reaches the PR. If it is dropped, that is the same surfacing gap from the review angle and naturally belongs in the same slice; if it is already posted, the empty-body slice is narrower.

_Suggested default: Treat as part of the same slice's discovery step — the answer (posted vs dropped) determines scope, not whether to do the work._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
