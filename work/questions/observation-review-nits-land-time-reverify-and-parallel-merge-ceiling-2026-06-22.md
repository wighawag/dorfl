<!-- dorfl-sidecar: item=observation:review-nits-land-time-reverify-and-parallel-merge-ceiling-2026-06-22 type=observation slug=review-nits-land-time-reverify-and-parallel-merge-ceiling-2026-06-22 allAnswered=false -->

## Q1

**Add story 7 to install-ci-tier1-branch-protection's `covers:` so the maintainer-perspective Tier-1 enforcement story isn't orphaned in the coverage map?**

> install-ci-tier1-branch-protection.md frontmatter lists `covers: [11]` only. Story 7 (GitHub maintainer wants propose PR un-mergeable while stale via required check + up-to-date) is the user-facing rendering of the same Tier-1 enforcement that slice already delivers — adding 7 is a one-line frontmatter fix, not new scope.

_Suggested default: promote-task (tiny coverage-map patch on that slice)_

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Yes, add story 7 to install-ci-tier1-branch-protection's `covers:`. It is a one-line frontmatter coverage-map fix for a story that slice already delivers. Fold this into the `land-time-reverify-and-parallel-merge-ceiling` PRD re-decompose (which I've decided to re-open in Tier B) rather than a standalone task, since that pass is touching this PRD's coverage map anyway.

## Q2

**Add story 9 to at least one of the propose-floor-closure slices (merge-question-surfacer / apply-rung-merge-disposition / merge-questions-gate-axis) so the headline 'runner-as-merger via advance surface/apply/answer' story is provably mapped?**

> merge-question-surfacer covers [14]; apply-rung-merge-disposition covers [15,16]; merge-questions-gate-axis covers [17]. Story 9 is the umbrella none of the three claims. Options: assign 9 to merge-question-surfacer (it's the entry point) or split across all three.

_Suggested default: promote-task — add 9 to merge-question-surfacer (the surface entry point of the trio)_

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Yes, assign story 9 to merge-question-surfacer (the surface entry point of the trio). Fold this into the PRD re-decompose pass, not a standalone task, since those three merge-question tasks are being re-scoped against the binary-sidecar model anyway.

## Q3

**Tighten adr-land-primitive-rebase-reverify-advance's acceptance criteria to make the Tier-2 (`merge_group`) deferral note REQUIRED prose, so deliberate non-delivery of story 8 is enforced by acceptance rather than author intent?**

> Story 8 is deliberately deferred per Applied Answer q3. The ADR slice already says to record the deferral as a forward seam, but it's bundled with cross-link items in one acceptance bullet — easy to lose in review. A dedicated acceptance bullet would harden it.

_Suggested default: promote-task (small acceptance-criteria tightening on the ADR slice)_

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Yes, harden the story-8 (`merge_group`/Tier-2) deferral into a dedicated acceptance bullet on the ADR slice so deliberate non-delivery is enforced by acceptance, not author intent. Fold into the PRD re-decompose pass.

## Q4

**Re-encode soft 'touches same file' blockers in the slice graph as a softer note rather than `blockedBy:`, so the dep graph reflects logical premise vs file-serialisation?**

> merge-questions-gate-axis `blockedBy: [merge-retries-gate-precedence]` is purely to serialise edits to the shared precedence helper, not a true logical premise. Same for cross-job-ref-based-land-lock's blocker on the same keystone (test-cross-job-concurrent-land's blocker IS logical — it needs the configurable cap). Risk: introducing a new 'soft-blocked' axis is a protocol/schema change; keeping the current hard blocker is harmless if reviewers know it's file-serialisation only.

_Suggested default: keep — file-serialisation via hard blocker is fine pragmatically; don't expand the schema for this_

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

Keep. File-serialisation via a hard `blockedBy:` is fine pragmatically; do not introduce a new soft-blocked axis (that is a protocol/schema change) for this. The hard blocker is harmless as long as reviewers know it is edit-serialisation, not a logical premise. A one-line note on the blocker explaining it is file-serialisation is enough if wanted.

## Q5

**Surface cross-job-ref-based-land-lock's three needsAnswers sub-decisions (stale-lock reclaim, scope-now-vs-follow-on, granularity) to the human in the SAME prompt batch as OQ6/OQ7, so all slice-level open questions for this brief land together?**

> cross-job-ref-based-land-lock.md `Open questions (needsAnswers)` lists 3 sub-decisions derived from Applied Answer q1's 'ship only if cheap; otherwise split' caveat — not numbered PRD OQs. The slicer correctly didn't guess. This is a batching/UX request to the human-facing surface prompt, not a code change.

_Suggested default: keep — already captured in that slice's needsAnswers; advance will surface them when the slice is picked up_

<!-- q5 fields: id=q5 -->

**Your answer** (write below this line):

Keep. cross-job-ref-based-land-lock's three sub-decisions are already captured in that slice's needsAnswers; advance will surface them when the slice is picked up. No separate batching action needed. (Note: cross-job-ref-based-land-lock is currently in tasks/cancelled/, so confirm its status during the re-decompose.)
