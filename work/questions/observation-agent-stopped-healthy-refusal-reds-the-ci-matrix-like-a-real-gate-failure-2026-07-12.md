<!-- dorfl-sidecar: item=observation:agent-stopped-healthy-refusal-reds-the-ci-matrix-like-a-real-gate-failure-2026-07-12 type=observation slug=agent-stopped-healthy-refusal-reds-the-ci-matrix-like-a-real-gate-failure-2026-07-12 allAnswered=true -->

Item: [`observation:agent-stopped-healthy-refusal-reds-the-ci-matrix-like-a-real-gate-failure-2026-07-12`](../notes/observations/agent-stopped-healthy-refusal-reds-the-ci-matrix-like-a-real-gate-failure-2026-07-12.md)

## Q1

**Which of A/B/C is the intended semantics of a red matrix leg going forward: should 'agent-stopped' flip to exitCode 0 and join vanished/already-triaged/no-op (A), stay exit 1 but be visually bucketed via GITHUB_STEP_SUMMARY and ::warning:: annotations (B), or get a third exit code that the workflow maps to a neutral/skipped leg (C)?**

> The observation lays out three coherent options and recommends B as least-invasive while noting A is cleaner if needs-attention surfacing is deemed a sufficient signal. This is a policy call about what 'red' MEANS on the autonomous loop; the exit code is pinned by 3 tests (test/do.test.ts:1051, :1084, test/do-remote.test.ts:253) plus the union doc at packages/dorfl/src/do.ts:131, so it will not be flipped unilaterally.

_Suggested default: B — keep exitCode 1 but add a per-tick GITHUB_STEP_SUMMARY bucketing outcomes into failed / refused-surfaced / benign-skip, plus ::warning:: (not ::error::) annotations on healthy refusals._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

A (effectively), but reached via the deeper fix, NOT the standalone exit-code flip this question assumes. This observation is SUPERSEDED by spec `surface-stuck-as-questions-and-retire-stuck-lock-state` (resolved decision #1). A bounce/`agent-stopped` now SURFACES a question sidecar on `main` + sets `needsAnswers:true` + RELEASES the lock; a cleanly-surfaced leg is then GREEN (`exitCode: 0`, joining `already-triaged`/`vanished`) because the tree is in a good, loop-drained state and the sidecar on `main` IS the "a human owes an answer" signal. So neither B (summary-only) nor C (third code): the legibility problem dissolves because the outcome becomes a real surfaced-question state, not a raw red. The 3 pinned tests (`do.test.ts:1051`/`:1084`, `do-remote.test.ts:253`) get updated by that spec's slices. Nuance: a bounce whose surface TRANSITION fails stays non-zero.

## Q2

**Should the additive per-tick GITHUB_STEP_SUMMARY writer that tallies outcomes by class (failed vs refused-surfaced vs benign-skip) ship FIRST regardless of the A-vs-B decision, since it changes no semantics and is the highest-value adopter-facing artifact?**

> The observation flags this as strictly additive (no exit-code or test churn) and notes no STEP_SUMMARY/annotation writer exists today (grep of src/ empty). Shipping it first would immediately relieve the 'wall of red X's' legibility problem while leaving the harder A-vs-B call open.

_Suggested default: Yes — ship the summary emitter first as a standalone legibility fix; treat the exit-code semantics of agent-stopped as a separate, later decision._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

No separate summary emitter. The `GITHUB_STEP_SUMMARY` bucketing was the option-B mitigation for keeping a red-but-legible leg; since the resolved direction (spec decision #1) makes a healthy bounce a GREEN surfaced-question outcome, the "wall of red" it was meant to relieve no longer exists. A per-tick summary may still be a nice-to-have for run legibility, but it is NOT needed as a mitigation here and should not gate or precede the spec's work. Dropped as unnecessary.

## Q3

**If option A is chosen (agent-stopped becomes exit 0), what compensating mechanism guarantees a stopped item does not get silently ignored — is the existing needs-attention surfacing PLUS the proposed run summary considered sufficient, or is an explicit follow-up (e.g. a nag/alert if an item sits in needs-attention across N ticks) required as part of the same change?**

> The observation notes the main risk of A: 'a green leg may get less attention', and the item requires a human ROUTING decision (re-scope, move to done, answer surfaced question). If A is chosen without a compensating surface, healthy stops could accumulate unnoticed.

_Suggested default: Rely on needs-attention + the new run summary; do not add a nag mechanism unless drift is observed in practice._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

The compensating mechanism IS the spec's core change, and it is stronger than "rely on needs-attention + a summary". Under the spec, a stopped item is not a hidden stuck-lock that a green leg might let slip; it is a `needsAnswers:true` item WITH a `work/questions/` sidecar visible on `main`, drained by the existing apply rung (answer -> `requeue`/`drop`). So the item is human-visible and loop-tracked by construction, not reliant on someone inspecting lock refs. No nag/alert mechanism is required. (The empty-diff "nothing to do" case additionally gets a delete-defaulted question so it cannot infinite-loop.) This is spec resolved decisions #1, #2, and #4.
