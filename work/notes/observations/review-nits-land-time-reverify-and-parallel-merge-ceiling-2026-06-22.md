---
title: review-gate non-blocking nits for 'land-time-reverify-and-parallel-merge-ceiling' (Gate 2 approve)
date: 2026-06-22
status: open
reviewOf: land-time-reverify-and-parallel-merge-ceiling
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'land-time-reverify-and-parallel-merge-ceiling' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Story 7 (GitHub maintainer wants propose PR UN-MERGEABLE while stale via required check + up-to-date) is delivered by install-ci-tier1-branch-protection but that slice's `covers:` only lists [11]. Add 7 so the user-facing requirement isn't orphaned in the coverage map.
  (install-ci-tier1-branch-protection.md frontmatter `covers: [11]`; story 7 in PRD is the maintainer-perspective rendering of the same Tier-1 enforcement.)
- Story 9 (runner-as-merger via advance surface/apply/answer) is delivered jointly by merge-question-surfacer + apply-rung-merge-disposition + merge-questions-gate-axis, but none of those three list 9 in `covers:`. Add 9 to at least merge-question-surfacer (or split across the three) so the headline propose-floor-closure story is provably mapped.
  (merge-question-surfacer covers [14]; apply-rung-merge-disposition covers [15,16]; merge-questions-gate-axis covers [17]. Story 9 is the umbrella; no slice claims it.)
- Story 8 (Tier-2 GitHub Merge Queue, `merge_group`) is deliberately deferred per Applied Answer q3 — the ADR slice records the deferral as a forward seam, which is the right move. Consider explicitly noting in the ADR slice's acceptance criteria that the deferral note is REQUIRED prose, so 'deliberate non-delivery is flagged as a named follow-up' is enforced by acceptance, not just author intent.
  (adr-land-primitive-rebase-reverify-advance.md lists the Tier-2 deferral as content to record; the acceptance bullet does say it, but it's bundled with cross-link items — clean to keep but easy to lose in review.)
- merge-questions-gate-axis is `blockedBy: [merge-retries-gate-precedence]` purely for file-serialisation on the shared precedence helper, not a true logical premise. That's fine, but could be encoded as a soft 'touches same file' note rather than a hard blocker so the graph reflects logical dependency. (Equally true for cross-job-ref-based-land-lock and test-cross-job-concurrent-land's blockers on merge-retries-gate-precedence — though the test one IS logical: it needs the configurable cap.)
  (merge-questions-gate-axis.md and cross-job-ref-based-land-lock.md both cite 'serialise by file to avoid conflicts'; merge-retries-gate-precedence is the keystone for the gate-precedence helper extension.)
- cross-job-ref-based-land-lock has needsAnswers covering stale-lock reclaim, scope-now-vs-follow-on, and granularity — derived from Applied Answer q1's caveat, not a numbered PRD OQ. The slicer correctly didn't guess. Worth surfacing to the human in the same batch as OQ6/OQ7 so all three slice-level open questions land on one prompt.
  (cross-job-ref-based-land-lock.md `Open questions (needsAnswers)` lists 3 sub-decisions derived from brief's 'ship only if cheap; otherwise split' steer.)
