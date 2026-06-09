---
title: review-gate non-blocking nits for 'intake-production-verdict-parse' (Gate 2 approve)
date: 2026-06-09
status: open
slug: intake-production-verdict-parse
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'intake-production-verdict-parse' but raised the following non-blocking findings (nits). They do not block integration; this is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the minor wording divergence from the slice: it specified `return parseIntakeVerdict(readOutput(launched.output))` reusing the review gate's `readOutput` lever, but the production path inlines `parseIntakeVerdict(launched.output ?? '')` instead of threading a `readOutput` option. Is this acceptable, or do you want the `readOutput` seam mirrored on intake for symmetry/testability with the review gate? (intake.ts:1013 uses `launched.output ?? ''` directly — functionally identical to the review gate's default `readOutput = (output) => output ?? ''` (review-gate.ts:285), and the code comments document the equivalence. Unlike `harnessReviewGate`, intake's `runDecision` does not expose a `readOutput?` override; the tested seam is the injected `decide` / the spy harness's `output` instead, which is sufficient for the slice's tests. This is an in-scope implementation choice the slice did not literally prescribe — a ratification, not a defect.)
- No `## Decisions` block was available to ratify (the slice is still in work/in-progress with only a claim commit and an uncommitted working tree, so there is no PR description yet). When the PR body is written, confirm it records the two in-scope choices made here: (1) the shared extractor's default discriminator key was set to `verdict` so the review-gate/slicer call sites stay unchanged (a cross-caller choice affecting two other commands' read sites), and (2) the `readOutput` seam was not mirrored on intake (note above). (git log shows only `claim: intake-production-verdict-parse`; the diff is unstaged. The shared `extractJsonObjectSpan(output, key='verdict')` default is the one cross-slice-interaction decision worth surfacing: it changes how review-gate.ts:124 and slicer-review-loop.ts:682 obtain their span (now via a shared module rather than a local copy). It is correct and low-risk to reverse, hence non-blocking.)
