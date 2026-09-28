---
'dorfl': patch
---

A build whose last model turn was cut off (pi recorded `stopReason: "length"`, the per-turn output-token cap, or `"error"`) and that left no source change is now routed as `agent-failed` (the failure route: work saved, surfaced, requeue-able) with a reason naming the truncated turn, instead of the empty-diff STOP whose surfaced question defaults to cancelling the task. The pi adapter reads how the run's final assistant message ended from the session log and exposes it as `LaunchResult.cutOffTurn`; in-place `do`, `do --remote`, `run` and the CI build agent phase (which hands it over as `agent-failed`) all apply the same guard. A normal end of turn with an empty diff still takes the empty-diff route, and an in-band STOP sentinel still wins.
