---
title: review-gate non-blocking nits for 'intake-lone-slice-bounded-internal-review' (Gate 2 approve)
date: 2026-06-10
status: open
slug: intake-lone-slice-bounded-internal-review
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'intake-lone-slice-bounded-internal-review' but raised the following non-blocking findings (nits). They do not block integration; this is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the lone-slice review only flips to ASK at the 3-round cap — it never flips EARLY on a blocking question with no thread answer, even though both the slice and the observation specify an early-flip trigger, and the review prompt tells the agent its `questions` block causes the runner to ask the human immediately. The outcome self-heals at the cap (correct terminal result, ≤2 extra agent launches), but the prompt's contract and the loop's behavior diverge. Intended to collapse both non-converge triggers into cap-only? (runLoneSliceReview (intake.ts ~1748): the loop returns 'converge' only on `approve` and 'non-converge' only after the for-loop exhausts LONE_SLICE_REVIEW_MAX_ROUNDS; there is no branch that flips on a `block`+`questions` round before the cap. buildLoneSliceReviewPrompt says: "`block` and put it in `questions`: the runner asks the human, carrying this draft.")
- Ratify: a review `edit` replaces only the slice BODY; the slice TITLE is never reviewable or editable and is carried verbatim from the decision verdict. Acceptable interpretation of 'full replacement slice body'? (runLoneSliceReview always returns `title: draftTitle` (= `verdict.sliceTitle ?? slug`); LoneSliceReviewVerdict has `edit?: string` (body only) and no title field. Documented in LoneSliceReviewResult as 'unchanged today; carried for symmetry.')
- The work-branch tip commit message is 'chore(...): save aborted work (wip)', which understates a complete, tested, scope-fenced implementation. Confirm this is the intended landing commit (message is cosmetic; the code is done). (git log tip: f0f8339 'chore(intake-lone-slice-bounded-internal-review): save aborted work (wip)'. The diff adds the full bounded-review feature + 551 lines of dedicated tests, all ACs covered; the slice file still carries a 'Needs attention: acceptance gate failed (exit 1)' line whose Requeue note attributes the failure to a now-fixed base-branch format RED, not this work.)
