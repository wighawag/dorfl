---
title: Cross-job ref-based land-lock accelerator (portable, with stale-lock reclaim)
slug: cross-job-ref-based-land-lock
spec: land-time-reverify-and-parallel-merge-ceiling
needsAnswers: false
blockedBy: [merge-retries-gate-precedence]
covers: [5]
reason: superseded-by-decision — no sound, model-consistent, cheap stale-lock reclaim exists for a land-lock; the SPEC explicitly allows splitting it out. The mergeRetries floor (merge-retries-gate-precedence) is correctness-sufficient; this accelerator is deferred to a follow-on. See the ANSWERED block.
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

## ANSWERED 2026-06-26 — VERDICT: CANCEL (split to a follow-on), the floor suffices

The three open questions are answered, and the answer to Q2 is the SPEC's own
exit clause: this accelerator should NOT ship in this SPEC. The task is CANCELLED
(moved to `tasks/cancelled/`); the `mergeRetries` floor
(`merge-retries-gate-precedence`) is the shipped cross-job serialiser and is
correctness-sufficient on its own.

1. **Stale-lock reclaim mechanism → (c) human-only reclaim is the ONLY
   model-consistent option, and it is a BAD FIT for a land-lock.** The repo's
   per-item lock doctrine EXPLICITLY rejects TTL/heartbeat auto-reclaim:
   WORK-CONTRACT states "there is no liveness heartbeat and no auto-sweep (a
   human asserts a lock is dead)", with reclaim via `release-lock` +
   `gc --ledger` (tasks/done: `release-lock-verb-and-gc-stuck-report`,
   `gc-ledger-reap-stale-locks-opt-in-flag`). So (a) a wall-clock TTL is OUT
   (clock skew across CI runners makes it unsound; a premature steal = a
   both-land race, the exact thing the land step must never do), and (b) a
   liveness check is OUT (there is no heartbeat signal to check). That leaves
   (c). But a human-only reclaim on the LAND TAIL is the wrong shape: the
   land-lock is meant to be an automatic accelerator held for SECONDS during a
   serialised land, not a lock a human babysits. A crashed holder would STALL
   ALL landings until a human runs `release-lock` — strictly WORSE than the
   floor's spurious bounce, which self-heals (re-rebase + re-gate + retry).
2. **In-scope-now vs follow-on → FOLLOW-ON (cancel this task).** Given (1),
   there is no SOUND + CHEAP + model-consistent reclaim story, which is exactly
   the SPEC's stated condition for splitting it out (Applied Answer q1: "If a
   robust stale-lock story is not cheap, ship (a) scaled NOW and split (b) into
   a follow-on"). The accelerator is a pure THROUGHPUT optimisation over an
   already-correct floor, so it is not worth a deadlock-prone or human-babysat
   lock. Capture it as a follow-on SPEC idea
   (`work/notes/ideas/cross-job-ref-land-lock-accelerator.md`) to revisit only
   if a real wide-matrix repo shows the floor's bounce rate is a problem AND a
   sound reclaim emerges (e.g. a host-provided lease the bare floor degrades
   away from).
3. **Lock granularity → PER-TARGET-BRANCH** (recorded for the follow-on, moot
   here). A land-lock must serialise only landings to the SAME branch; per-repo
   would needlessly serialise independent branch landings. Key it
   `refs/dorfl/land-lock/<branch>`, not one global `refs/dorfl/land-lock`.

Consequence for siblings: `test-cross-job-concurrent-land` keeps its FLOOR-only
assertions (its body already says "if `cross-job-ref-based-land-lock` ships, this
test grows a variant ... if it does not, the test asserts the floor only") — no
change needed there.

## Open questions (RESOLVED — see the ANSWERED/VERDICT block above)

The spec (Applied Answer q1) says: ship this task only if a SOUND
stale-lock reclaim story is cheap; otherwise split it out. Concretely:

1. **Stale-lock reclaim mechanism.** A ref-lock held by a crashed job
   must be reclaimable, or it becomes a self-inflicted deadlock strictly
   worse than the floor's spurious bounce. What is the reclaim
   mechanism? Options: (a) TTL encoded in the lock-ref's value with a
   wall-clock check; (b) a holder-liveness check (and against what
   signal — there is explicitly no heartbeat in the per-item lock
   model); (c) a human-only reclaim verb (`release-lock`-style) that
   refuses to ship without admin opt-in. Pick one and justify.
2. **In-scope-now vs follow-on.** Given (1)'s answer, is this task
   cheap enough to ship in this spec, or should it be split into a
   follow-on spec and this task cancelled? The spec explicitly
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
