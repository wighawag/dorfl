---
title: 'A model turn truncated at the output-token cap is read as the agent judging "nothing to do", and the surfaced question defaults to cancelling the task'
slug: a-truncated-model-turn-is-read-as-nothing-to-do-and-defaults-to-cancel
date: 2026-09-28
status: spotted
---

2026-09-28, measured while driving `ci-split-answered-merge-action` (`dorfl do task:ci-split-answered-merge-action --isolated --allow-backlog --propose --no-review`, pi harness).

## What happened

About eight minutes into the build, the agent's last assistant turn ended with `stopReason: "length"` and `usage.output: 16384`: the whole output budget went into a thinking block, with no text and no tool call. pi's `--print` run then ended, the worktree had no source change, and the runner routed it as an empty-diff STOP:

```
The agent STOPPED building 'ci-split-answered-merge-action' (empty diff); surfaced a dispose-defaulted question on origin/main and released the lock.
```

The surfaced sidecar (`work/questions/task-ci-split-answered-merge-action.md`) asks "Cancel this item? [default: yes]". The task is real, unbuilt work (a whole phase split); nothing about it is "nothing to do". An autonomous `advance` applying the default would have moved it to `work/tasks/cancelled/`.

## Why it matters

The empty-diff route exists for a deliberate LLM judgement that there is nothing to build. A turn cut off by the output-token cap is not a judgement, it is a harness failure, and it should route like one (`agent-failed`, requeue-able), never to a dispose-defaulted question. The signal is available: the session's last assistant message carries `stopReason: "length"` (or `"error"`), which the pi harness record could expose to the runner.

Two separate levers:

- **Classification.** When the session's final assistant turn stopped for `length` / `error` rather than `stop` / end-of-turn, treat the run as `agent-failed` (the existing failure route with its WIP save), not as an empty-diff STOP.
- **Budget.** 16,384 output tokens per turn is small for a thinking model on a large task; a single long deliberation can exhaust it. Worth checking whether the model's max-output setting for the build agent can be raised, or thinking bounded.

Unverified: how often this happens, and whether pi retries a `length` stop on its own in other modes.
