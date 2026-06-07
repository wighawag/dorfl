---
title: reviewMaxRounds was built onto the review GATE by miscommunication — it belongs to the slicer EDIT LOOP, not the gate
date: 2026-06-06
status: open
---

## The signal

The `review-gate-pr` slice (Gate 2, shipped in PR #11) added a **`reviewMaxRounds`**
config knob to the GATE: the gate invokes the reviewer up to N rounds and, on a
persistent `block`, forces needs-attention. Reviewing #11 already smelled this:
"`reviewMaxRounds` is a loop without a revise step — it just re-reviews the same
diff N times, which does nothing useful."

Maintainer clarified (2026-06-06) that this was a **miscommunication**: the review
GATE does NOT need a round bound. A gate is **one-shot pass/fail** — approve
(proceed) or block (→ needs-attention). There is no revise step *inside a gate*, so
re-reviewing the same artifact N times is meaningless (same input → same verdict).

## Where the bound actually belongs

The thing that genuinely LOOPS is the **slicer edit loop** (a SEPARATE concept from
the gate — see `work/findings`/the eventual `review` PRD grilling pass note):
review → feed findings back into EDITS → re-review → converge. THAT loop needs a
ceiling so an unattended review↔edit cycle can never run forever. So:

- **`reviewMaxRounds` belongs to the SLICER EDIT LOOP**, per-repo configurable (the
  usual flag > env > per-repo > global > default chain), as its infinite-loop
  safety ceiling. Its natural terminator is still "a pass finds no NEW blocking
  issue" (passes taper to zero — see the idea file); `reviewMaxRounds` is only the
  hard cap on top.
- **It does NOT belong to the review GATE** (impl or slice). The gate is terminal.

## Disposition (do NOT act yet — maintainer will call the slicing pass)

- **Keep the parameter for now** (it is live in the Gate-2 code; removing it is a
  separate change). Do NOT delete it in isolation.
- **Later: remove `reviewMaxRounds` from the review GATE** (`complete`/`do`
  Gate-2 path: `reviewPr`/`autoMerge`/`reviewModel` stay; the rounds loop +
  `reviewMaxRounds` go). The gate becomes a single reviewer invocation → verdict.
- **Later: (re)introduce `reviewMaxRounds` on the SLICER EDIT LOOP** when that is
  built — same name, NEW home + meaning (loop ceiling, not gate retries),
  per-repo. So this is a MOVE + reframe, not a pure deletion.
- Until the slicer edit loop exists and the gate is simplified, the parameter is an
  orphan on the wrong concept — flagged here so it does not silently calcify into
  "load-bearing."

(Captured 2026-06-06 during the review-gate / slicer-review discussion, immediately
after PRs #11+#12 landed the gate + the agent-output seam.)
