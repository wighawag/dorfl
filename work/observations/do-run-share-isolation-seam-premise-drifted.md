# `do-run-share-isolation-seam` slice premise has drifted (2026-06-07)

The slice `do-run-share-isolation-seam` rests on three premises that no longer
match `packages/agent-runner/src`:

1. It says "route `run` through the seam, replacing its **direct `createJob`
   use**". But `run.ts`'s `runOneItem` already routes through
   `jobWorktreeStrategy({...}).prepare()` → the `IsolatedTree` handle →
   `tree.teardown()` (and the post-claim band is even extracted to the shared
   `performIntegration` core). `run` does NOT call `createJob` directly. This
   landed in `run-daemon-reframe` / the integration-core convergence.

2. It says to REPLACE "the `do-remote` Option-A bespoke materialise/reap glue …
   (no duplicate isolation logic left)". But `performDoRemote` (`do.ts`) already
   uses `jobWorktreeStrategy(...).prepare()` + `tree.teardown()` (the handle) —
   there is no bespoke materialise/reap glue left to fold in. That landed in
   `do-remote`.

3. It says the seam has "ZERO real consumers" and this slice "finally gives the
   seam two real consumers". But `jobWorktreeStrategy` already has two production
   consumers (`run` and `do --remote`).

What IS genuinely unconsumed in production: `selectIsolationStrategy` (the "is
there a checkout?" dispatcher) and `inPlaceStrategy` — only `isolation.test.ts`
uses them. The ONLY consumer not on the seam is **`do` in-place** (`performDo`),
which composes `performStart`/`performComplete` on a literal `cwd`.

So the real remaining gap is narrow (wire in-place `do` through
`selectIsolationStrategy({checkout})`/`inPlaceStrategy`), but the slice's
acceptance criteria, "byte-identical run", and "fold in Option-A glue" framing
describe a much larger refactor that is mostly already done — building it
literally would churn working, tested `run`/`do --remote` code. Routed to
needs-attention for a human to re-scope (likely: shrink to "wire in-place `do`
onto the seam" only, and reconcile the open tension that in-place `do`
deliberately composes `start`/`complete` rather than calling `inPlaceStrategy`).
