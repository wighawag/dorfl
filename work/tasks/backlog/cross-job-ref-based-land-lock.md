---
title: Cross-job ref-based land-lock accelerator (portable, with stale-lock reclaim)
slug: cross-job-ref-based-land-lock
prd: land-time-reverify-and-parallel-merge-ceiling
needsAnswers: true
blockedBy: [merge-retries-gate-precedence]
covers: [5]
---

## What to build

The OPTIONAL portable accelerator for cross-job merge serialisation
(Applied Answer q1 part (b)): a ref-based land-lock — CAS-claim a sentinel
ref (e.g. `refs/dorfl/land-lock`) so losers QUEUE / back off rather
than burn CAS-retry attempts and bounce. Pure ref CAS, works against a
bare arbiter — so it does not violate the git-alone floor framing the way
GitHub-Actions `concurrency:` would.

This is the cross-job analogue of the in-process `integrateLock`. It SITS
ON TOP of the scaled `mergeRetries` floor (`merge-retries-gate-precedence`)
and must degrade to that floor if the lock is unavailable.

## Open questions (needsAnswers)

The prd (Applied Answer q1) says: ship this slice only if a SOUND
stale-lock reclaim story is cheap; otherwise split it out. Concretely:

1. **Stale-lock reclaim mechanism.** A ref-lock held by a crashed job
   must be reclaimable, or it becomes a self-inflicted deadlock strictly
   worse than the floor's spurious bounce. What is the reclaim
   mechanism? Options: (a) TTL encoded in the lock-ref's value with a
   wall-clock check; (b) a holder-liveness check (and against what
   signal — there is explicitly no heartbeat in the per-item lock
   model); (c) a human-only reclaim verb (`release-lock`-style) that
   refuses to ship without admin opt-in. Pick one and justify.
2. **In-scope-now vs follow-on.** Given (1)'s answer, is this slice
   cheap enough to ship in this prd, or should it be split into a
   follow-on prd and this slice cancelled? The prd explicitly
   allows the latter.
3. **Lock granularity.** One global land-lock per repo, or
   per-target-branch? (Per-repo is simpler; per-branch matches future
   multi-branch land flows.)

Do NOT build until these are answered.

## Acceptance criteria

- [ ] Ref-based land-lock claimed/released around the LAND tail in
      `integration-core.ts`; if claim fails, callers queue/back off, NOT
      bounce to needs-attention.
- [ ] Stale-lock reclaim implemented per the resolved mechanism; tested
      against a simulated crashed holder.
- [ ] Falls back to the `mergeRetries` floor if the lock-ref can't be
      created (older arbiter / permission failure), preserving the floor
      framing.
- [ ] Cross-job concurrency test (`test-cross-job-concurrent-land`) is
      updated to exercise the ref-lock path.
- [ ] Acceptance gate green.

## Blocked by

- `merge-retries-gate-precedence` — this accelerator sits on top of the
  floor; both touch the same `integration-core.ts` merge tail and must be
  serialised by file to avoid conflicts.

## Prompt

> Do NOT build until the three open questions above are answered by a
> human. Once answered: read Applied Answer q1 again with the answers in
> hand, then implement the ref-lock as a thin wrapper around git's ref
> CAS (mirror the way other parts of the codebase do CAS pushes against
> the arbiter — see `integrator.ts` and `cas-create-nonce-authoritative-
> same-identity.md` in `tasks/done/`). Tests must hit external behaviour:
> two simulated cross-job contenders, one lands, the other queues, both
> end green; a simulated stale-lock is reclaimed within bound. Run the
> AGENTS.md acceptance gate. Record decisions per task-template.
