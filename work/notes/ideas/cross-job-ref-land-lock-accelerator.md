---
needsAnswers: false
---

# Cross-job ref-based land-lock accelerator (deferred from land-time-reverify; revisit only if the floor's bounce rate hurts)

2026-06-26

Split out of the PRD `land-time-reverify-and-parallel-merge-ceiling` (its US #5 /
Applied Answer q1 part (b)). The task `cross-job-ref-based-land-lock` was
CANCELLED (`tasks/cancelled/`) because no sound, cheap, model-consistent
stale-lock reclaim story exists for it; this idea preserves the concept for a
future revisit.

## The idea

A portable cross-job merge-land serialiser: CAS-claim a sentinel ref
(`refs/dorfl/land-lock/<branch>`, PER-TARGET-BRANCH) so concurrent CI jobs racing
to land QUEUE / back off instead of burning `mergeRetries` attempts and bouncing
to needs-attention. Pure git ref CAS, so it works against a bare `--bare` arbiter
(unlike GitHub-Actions `concurrency:`, which would violate the git-alone floor
framing). It is the cross-job analogue of the in-process `integrateLock`, sitting
ON TOP of the `mergeRetries` floor and degrading to it if the lock-ref can't be
created.

## Why it was deferred (the blocking problem)

The repo's per-item lock doctrine EXPLICITLY rejects auto-reclaim:
WORK-CONTRACT says "there is no liveness heartbeat and no auto-sweep (a human
asserts a lock is dead)" (reclaim is `release-lock` + `gc --ledger`). So for a
land-lock:

- A wall-clock **TTL** is unsound across CI runners (clock skew -> premature
  steal -> a both-land race, the one thing the land step must never do).
- A **liveness/heartbeat** check has no signal to read (there is none by design).
- A **human-only reclaim** is the only model-consistent option, but it is the
  wrong shape for a lock meant to be held for SECONDS automatically: a crashed
  holder STALLS ALL landings until a human runs `release-lock` -- strictly worse
  than the floor's spurious bounce, which self-heals (re-rebase + re-gate +
  retry).

So the accelerator's reclaim story is NOT cheap, which is exactly the PRD's
stated condition for splitting it out. The `mergeRetries` floor
(`merge-retries-gate-precedence`) is correctness-sufficient on its own; this is a
pure throughput optimisation that is not worth a deadlock-prone or
human-babysat lock today.

## Revisit when (the trigger to turn this into a PRD)

Both must hold:

1. A real wide-matrix repo shows the floor's spurious-bounce rate under a merge
   burst is an actual operational problem (not a hypothetical), AND
2. A SOUND reclaim emerges -- most likely a HOST-PROVIDED lease (a capable host's
   native lock/queue with its own liveness) that the bare floor degrades away
   from, rather than a hand-rolled TTL on a ref. That keeps the git-alone floor
   honest (no auto-reclaim there) while letting a capable host raise the ceiling.

## Decisions already made (carry into the follow-on PRD)

- Granularity: PER-TARGET-BRANCH (`refs/dorfl/land-lock/<branch>`), not one
  global per-repo lock.
- Must degrade to the `mergeRetries` floor if the lock-ref is unavailable
  (older arbiter / permission failure), preserving the floor framing.
- `test-cross-job-concurrent-land` stays FLOOR-only until/unless this ships (its
  body already accounts for both cases).
