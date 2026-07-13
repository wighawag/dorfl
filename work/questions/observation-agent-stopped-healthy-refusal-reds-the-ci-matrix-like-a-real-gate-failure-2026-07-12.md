<!-- dorfl-sidecar: item=observation:agent-stopped-healthy-refusal-reds-the-ci-matrix-like-a-real-gate-failure-2026-07-12 type=observation slug=agent-stopped-healthy-refusal-reds-the-ci-matrix-like-a-real-gate-failure-2026-07-12 allAnswered=false -->

Item: [`observation:agent-stopped-healthy-refusal-reds-the-ci-matrix-like-a-real-gate-failure-2026-07-12`](../notes/observations/agent-stopped-healthy-refusal-reds-the-ci-matrix-like-a-real-gate-failure-2026-07-12.md)

## Q1

**Which of A/B/C is the intended semantics of a red matrix leg going forward: should 'agent-stopped' flip to exitCode 0 and join vanished/already-triaged/no-op (A), stay exit 1 but be visually bucketed via GITHUB_STEP_SUMMARY and ::warning:: annotations (B), or get a third exit code that the workflow maps to a neutral/skipped leg (C)?**

> The observation lays out three coherent options and recommends B as least-invasive while noting A is cleaner if needs-attention surfacing is deemed a sufficient signal. This is a policy call about what 'red' MEANS on the autonomous loop; the exit code is pinned by 3 tests (test/do.test.ts:1051, :1084, test/do-remote.test.ts:253) plus the union doc at packages/dorfl/src/do.ts:131, so it will not be flipped unilaterally.

_Suggested default: B — keep exitCode 1 but add a per-tick GITHUB_STEP_SUMMARY bucketing outcomes into failed / refused-surfaced / benign-skip, plus ::warning:: (not ::error::) annotations on healthy refusals._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Should the additive per-tick GITHUB_STEP_SUMMARY writer that tallies outcomes by class (failed vs refused-surfaced vs benign-skip) ship FIRST regardless of the A-vs-B decision, since it changes no semantics and is the highest-value adopter-facing artifact?**

> The observation flags this as strictly additive (no exit-code or test churn) and notes no STEP_SUMMARY/annotation writer exists today (grep of src/ empty). Shipping it first would immediately relieve the 'wall of red X's' legibility problem while leaving the harder A-vs-B call open.

_Suggested default: Yes — ship the summary emitter first as a standalone legibility fix; treat the exit-code semantics of agent-stopped as a separate, later decision._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**If option A is chosen (agent-stopped becomes exit 0), what compensating mechanism guarantees a stopped item does not get silently ignored — is the existing needs-attention surfacing PLUS the proposed run summary considered sufficient, or is an explicit follow-up (e.g. a nag/alert if an item sits in needs-attention across N ticks) required as part of the same change?**

> The observation notes the main risk of A: 'a green leg may get less attention', and the item requires a human ROUTING decision (re-scope, move to done, answer surfaced question). If A is chosen without a compensating surface, healthy stops could accumulate unnoticed.

_Suggested default: Rely on needs-attention + the new run summary; do not add a nag mechanism unless drift is observed in practice._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
