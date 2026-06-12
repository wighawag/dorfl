---
title: review-gate non-blocking nits for 'run-internal-error-tests' (Gate 2 approve)
date: 2026-06-12
status: open
slug: run-internal-error-tests
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'run-internal-error-tests' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Acceptance criterion #7 requires discharging the two nits in `work/observations/review-nits-run-daemon-reframe-2026-06-07.md`, but no file at that path exists under `work/observations/` and the diff touches no `review-nits` file. Was that nit already discharged elsewhere (the `run-daemon-reframe` slice is in `work/done/`), or does the slice cite a stale observation path?
  (Only one of the two source observations (`run-thrown-core-error-labeled-agent-failed.md`) is updated in the diff. Observation/folder bookkeeping is the runner/human's git job in this repo, not the agent's, so this is a ratification/bookkeeping check, not a code defect.)
- The HEAD commit is labelled 'save aborted work (wip)', the slice is still in `work/in-progress/` with a prior 'acceptance gate failed (exit 1)' note, and the requeue note attributes the prior red to a known unrelated triage-CAS flake. Confirm the now-green Gate 1 is the genuine result for THIS diff before the done-move.
  (This diff touches the claim-cas + run paths, not the advance-triage CAS the flake note names, so the flake-attribution is consistent. The review runs on an asserted-green gate; this is a confirmation the human/runner should make at integration, not a defect in what landed.)
