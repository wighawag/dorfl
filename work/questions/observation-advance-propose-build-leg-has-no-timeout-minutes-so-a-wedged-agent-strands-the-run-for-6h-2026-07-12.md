<!-- dorfl-sidecar: item=observation:advance-propose-build-leg-has-no-timeout-minutes-so-a-wedged-agent-strands-the-run-for-6h-2026-07-12 type=observation slug=advance-propose-build-leg-has-no-timeout-minutes-so-a-wedged-agent-strands-the-run-for-6h-2026-07-12 allAnswered=false -->

Item: [`observation:advance-propose-build-leg-has-no-timeout-minutes-so-a-wedged-agent-strands-the-run-for-6h-2026-07-12`](../notes/observations/advance-propose-build-leg-has-no-timeout-minutes-so-a-wedged-agent-strands-the-run-for-6h-2026-07-12.md)

## Q1

**What timeout-minutes value should be set on the advance-propose (and advance-merge) jobs in .github/workflows/advance-lifecycle.yml as the immediate backstop?**

> Observation Recommended-action §1: add timeout-minutes above a legitimate worst-case build-agent session but well under GitHub's 6h default. Confirmed by grep: no timeout at job/step level today (workflow L237+, L302+). This is a host-workflow change only, not a protocol change.

_Suggested default: 90 minutes on both advance-propose and advance-merge (well above typical build+review, well under 6h)._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Does dorfl advance --propose impose any per-leg wall-clock deadline in the engine itself, or is the GitHub 6h default the only bound?**

> Observation 'Still open' §1. The 2h silent leg on run 29206312575 implies no engine cap fired. If the engine has no per-leg budget, the CI timeout-minutes is the only reliable backstop; if it does, its threshold needs re-tuning.

_Suggested default: No engine-level per-leg deadline exists today; add one as a follow-up task, but ship the CI timeout-minutes backstop first._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Should max-parallel be reduced (or a rate-limit-aware scheduler added) to prevent 4 concurrent agent sessions from tipping the shared provider key into 429 backoff?**

> Observation 'Still open' §2 + Confirmed §1: tool-call bursts separated by ~20/39/60-min stalls match 429 backoff on the shared key. The workflow's own comment predicts this failure mode at max-parallel: 4.

_Suggested default: Keep max-parallel: 4 but rely on the new timeout-minutes to reap throttled legs; revisit lowering it if the pattern recurs after the backstop lands._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Does the agent's model client cap total backoff, or can a single turn wait ~1h as the log suggests?**

> Observation 'Still open' §3: the 60-min inter-turn gap suggests either very long backoff or repeated re-throttle cycles. A capped backoff would surface a clean failure instead of a silent stall.

_Suggested default: Investigate as part of the root-cause follow-up task, not as a blocker for the CI backstop._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

## Q5

**Should this observation be promoted as TWO tasks (the cheap CI backstop + a deeper root-cause / repro task), or bundled as one?**

> Observation 'Note on scope': the backstop is small/safe/immediate; the underlying wedge needs a reproduction before any fix. The author explicitly leaves this split for a human to decide.

_Suggested default: Two tasks: (a) add timeout-minutes to advance-propose/advance-merge now; (b) separate deeper root-cause task pending a second repro._

<!-- q5 fields: id=q5 -->

**Your answer** (write below this line):
