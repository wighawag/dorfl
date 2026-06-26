---
title: review-gate non-blocking nits for 'merge-questions-gate-axis' (Gate 2 approve)
date: 2026-06-26
status: open
reviewOf: merge-questions-gate-axis
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'merge-questions-gate-axis' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the deferral of acceptance-criterion #3 ('merge-question-surfacer is invoked iff this gate says so') to the sibling surfacer task. This PR delivers only the config-plumbing half of the gate; no call site consults cfg.mergeQuestions yet because the surfacer lives in tasks/ready/merge-question-surfacer.md and has not landed. The task body explicitly anticipates this split ('build it together with / after merge-question-surfacer ... so the wiring lands against the reshaped surfacer'), so the split is principled, but it leaves a future-build burden: the surfacer's reviewer must verify the gate is actually read at the invocation site, otherwise this axis becomes dead config. Worth a Decisions-block entry and a tracking note on the surfacer task.
  (work/tasks/done/merge-questions-gate-axis.md acceptance list item 3 vs. ripgrep showing zero readers of cfg.mergeQuestions outside config/test files.)
- Ratify the surface-area choices the task did not spell out: env var spelled DORFL_MERGE_QUESTIONS (screaming-snake of the camelCase key, matches the family helper) and flag spelled --merge-questions (kebab of same). Both look right and consistent with observationTriage / DORFL_OBSERVATION_TRIAGE / --observation-triage, but they are user-visible defaults introduced here without being named in the applied answers.
  (src/env-config.ts L67-72, src/cli.ts L2508-2510.)
