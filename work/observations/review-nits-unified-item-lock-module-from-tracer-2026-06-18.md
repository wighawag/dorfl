---
title: review-gate non-blocking nits for 'unified-item-lock-module-from-tracer' (Gate 2 approve)
date: 2026-06-18
status: open
reviewOf: unified-item-lock-module-from-tracer
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'unified-item-lock-module-from-tracer' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the unrecorded REPLACE-vs-wrap decision: the agent chose to REPLACE the tracer (`item-lock-ref.ts` git-renamed to `item-lock.ts`, test renamed too, tracer fully removed) rather than wrap it, but did not record this in a `## Decisions` block even though the slice prompt explicitly asked it to. The choice is sound (avoids a redundant duplicate primitive and keeps one canonical file); it just needs a human to ratify and ideally note it.
  (Slice prompt closing line: 'RECORD any non-obvious in-scope decision (e.g. whether the production module REPLACES `item-lock-ref.ts` or wraps it) per the slice-template guidance.' The diff shows `rename src/{item-lock-ref.ts => item-lock.ts}` and `rename test/{item-lock-ref.test.ts => item-lock.test.ts}`; the commit message a317372 contains no Decisions block.)
- Ratify the `AcquireOutcome`/`ReleaseOutcome` carrying an `error` variant beyond the slice's stated `acquired|lost` / `released|not-held`. It is used for missing-item and underlying-git failures. This is reasonable production hardening (and was already present in the tracer), but it is a user-visible API surface the dependent caller-wiring slices will branch on, so worth a deliberate nod.
  (item-lock.ts: `export type AcquireOutcome = 'acquired' | 'lost' | 'error';` and `ReleaseOutcome = 'released' | 'not-held' | 'error';`. The slice text describes `acquire(item, action) -> acquired|lost` and `release(item) -> released|not-held` without the `error` arm. No test exercises the `error` outcome path.)
