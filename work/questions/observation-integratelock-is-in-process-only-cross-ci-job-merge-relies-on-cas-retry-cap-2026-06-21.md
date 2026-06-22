<!-- agent-runner-sidecar: item=observation:integratelock-is-in-process-only-cross-ci-job-merge-relies-on-cas-retry-cap-2026-06-21 type=observation slug=integratelock-is-in-process-only-cross-ci-job-merge-relies-on-cas-retry-cap-2026-06-21 allAnswered=false -->

## Q1

**What is the terminal disposition of this observation — does it become an ADR capturing the cross-runner CAS-is-the-queue / within-runner lock-is-the-optimisation rule (plus a sizing policy for `DEFAULT_MERGE_RETRIES` vs. expected CI matrix width, and/or a cross-job concurrency-group mutex), promote to a slice that actually implements that sizing/mutex now, or just keep as a forward-looking note until a parallel-merge CI shape is designed?**

> The observation notes that `run.ts`'s `createKeyedLock()` only serialises land-tails within ONE `run` process; across separate CI jobs the only linearisation is the arbiter-ref CAS loop, capped at `DEFAULT_MERGE_RETRIES = 5` (sized for in-process siblings, not a wide matrix). The author's own framing is 'Decision to record when the CI parallel-merge shape is designed' and 'Not fixing here' — i.e. they lean toward an ADR-shaped capture rather than an immediate slice, but explicitly defer the call. A wide matrix could otherwise route losers to needs-attention as spurious 'persistent contention'.

_Suggested default: promote-adr — record the rule (CAS = cross-runner queue; in-proc lock = optimisation) and the sizing/concurrency-group obligation, but defer the actual retry-cap change / mutex implementation until a parallel-merge CI shape is on the table._

<!-- q1 fields: id=q1 disposition=promote-adr -->

**Your answer** (write below this line):

promote-adr — record the rule, defer the change. Verified: the integrate-lock is in-process only (serialises land-tails within ONE `run` process), and cross-job/cross-runner merge serialisation relies on the bounded CAS retry (`DEFAULT_MERGE_RETRIES = 5`), which was sized for in-process siblings, not a wide CI matrix. The ADR should capture the durable rule (CAS = the cross-runner queue; the in-process lock is only a within-runner optimisation) plus the sizing obligation (retry cap vs expected matrix width, and/or a cross-job concurrency-group mutex). Do NOT implement the sizing/mutex change now — the parallel-merge CI shape is not yet designed. Note: a ready brief (`land-time-reverify-and-parallel-merge-ceiling`) already cites this observation, so prefer FOLDING this rule into that brief's eventual ADR rather than spinning a standalone one. Disposition: promote-adr.
