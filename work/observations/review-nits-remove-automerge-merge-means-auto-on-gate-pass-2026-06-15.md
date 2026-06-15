---
title: review-gate non-blocking nits for 'remove-automerge-merge-means-auto-on-gate-pass' (Gate 2 approve)
date: 2026-06-15
status: open
slug: remove-automerge-merge-means-auto-on-gate-pass
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'remove-automerge-merge-means-auto-on-gate-pass' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Should `work/prd/runner-in-ci.md` (lines 120, 160) and the observation `work/observations/reviewmaxrounds-on-wrong-concept.md` be updated to drop the now-deleted `autoMerge` knob, so no live shaping doc still presents it as tunable?
  (These are LIVE docs (a PRD and an observation) that still list `review`/`autoMerge` as a current config knob and reference `review: on + autoMerge: on`. The slice only committed to updating `work/prd-sliced/review.md` + the ADR, so leaving these is within the slice's stated scope, but they are genuinely stale after the hard delete. Historical records under work/done/ and the fenced-out convergence notes correctly describe the prior state and were rightly untouched.)
- Drop the now-dead `"autoMerge": false` key from this repo's `.agent-runner.json` (line 10)?
  (The slice explicitly left live-config editing to the human and the key is now harmlessly inert (proven by the new stale-key test). Flagging only so it gets cleaned on a convenient pass rather than lingering as dead config.)
- Ratify the decision to retain complete.ts's `requestedMode`-vs-`mode` variable distinction (rather than collapsing to a single variable) now that effective mode always equals requested?
  (With the downgrade gone the distinction is dead nuance, but the agent kept both variables and updated the comments to say so honestly (no comment asserts a nonexistent downgrade). This is a defensible minimal-change choice that satisfies the slice criterion; recording it for ratification since the slice invited simplifying the plumbing 'if it reads clearly'.)
