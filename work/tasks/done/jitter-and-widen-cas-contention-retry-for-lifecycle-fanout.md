---
title: 'Jitter + widen the CAS contention-retry so a lifecycle fan-out drains instead of exiting contended'
slug: jitter-and-widen-cas-contention-retry-for-lifecycle-fanout
covers: []
blockedBy: []
---

## What to build

When a lifecycle tick fans out many parallel `advance --propose` legs (one per answered/triaged item), each leg's terminal write is a treeless append to the arbiter's `main` through the create/publish CAS. Today that CAS loop retries CONTENTION (a rejected push because `main` advanced under us) INSTANTLY with NO delay and a small fixed cap (default 3 retries → the 4th rejection returns `exitCode: 3, outcome: 'contended'`). This is optimal for a SINGLE contender (grab the new base and go), but pathological under a fan-out: N legs all refetch-and-repush in lockstep against the same ref, so they keep colliding, burn the tiny retry budget, and a large fraction exit `contended` (exit 3) on every tick, reddening the run even though each leg's work is valid and would succeed if the legs simply took turns. Nothing human waits on a lifecycle leg, so there is no reason to give up after 3 instant retries.

Fix the CONTENTION regime for this fan-out case: (a) add randomized JITTER to the inter-retry delay so parallel legs desync and stop retrying at the same instant, and (b) WIDEN the retry budget (more attempts / a wall-clock budget) since a lifecycle apply has no latency SLA. The goal: a fan-out of independent appends DRAINS (every leg eventually lands its treeless commit by taking a turn) instead of a thundering-herd that leaves most legs `contended`.

Design constraints (important, do not just bolt exponential backoff on):

- The contention regime is DELIBERATELY DISTINCT from the OUTAGE regime. `retry-backoff.ts` documents this explicitly: its exponential backoff is for an UNREACHABLE remote (the remote may come back), whereas contention (a REJECTED push against a moved ref) is retried instantly against the new base. Do NOT conflate them. Contention wants a SMALL RANDOM delay to break lockstep (decorrelated jitter), NOT an exponential ramp modelling an outage. This task REVISES the recorded "contention retries instantly, no delay" decision for the fan-out case, so RECORD that revision (a `## Decisions` note or, if it meets the bar, an ADR): the new model is "contention retries with bounded jittered delay + a widened budget," and WHY (thundering-herd on a shared arbiter ref under a lifecycle fan-out).
- Keep the SLEEP injectable (reuse the `Sleep` / `realSleep` seam `retry-backoff.ts` and `run.ts` already use) and inject the RNG, so tests drive the retry timeline AND the jitter deterministically with no real waits and no flakiness. Mirror the existing recovery-rebase-retry jitter seam (`integration-core.ts` already injects both `Sleep` and an RNG for its jittered retry loop) rather than inventing a new pattern.
- The cap must still be BOUNDED (a clean give-up into `contended`, never an indefinite hang) — just wider, and time-budgeted rather than a tiny fixed count. Pick sane defaults (e.g. a wall-clock budget in the tens of seconds with a decorrelated-jitter delay), and make them configurable so a repo can tune the fan-out patience.
- The interactive / human-facing CAS callers (claim, the single-item paths) must NOT get a worse experience: a human typing a command still wants a reasonably prompt bounded give-up. Scope the widened budget to the lifecycle/treeless-apply path (or make it a parameter the lifecycle driver passes), NOT a blanket change that makes an interactive `claim` sit for a minute. Decide and record where the wider budget applies.

This composes with (does NOT duplicate) the sibling held-lock subtraction work: `advance-matrix-enumerates-held-locked-items-so-legs-fail-every-tick` reduces the NUMBER of contending legs by never enumerating a held/stuck item into the matrix. THIS task handles the remaining LEGITIMATE contention among the valid legs that do get scheduled. Reference that sibling; the two layers together should quiet the propose-matrix CI noise.

## Acceptance criteria

- [ ] The CAS contention-retry (the `main advanced under us — refetch and retry` loop in `advancing-lock.ts`) applies a bounded, RANDOMIZED-jitter inter-retry delay on the lifecycle/treeless-apply path (parallel legs no longer retry in lockstep).
- [ ] The retry budget on that path is WIDENED (more attempts / a wall-clock budget) so a fan-out of independent valid appends drains rather than a large fraction exiting `contended`; the budget is configurable with a sane default.
- [ ] The regime stays BOUNDED: on genuine exhaustion it still returns a clean `contended` give-up (exit 3), never an indefinite hang.
- [ ] The sleep AND the RNG are injected (reusing the existing `Sleep`/`realSleep` + RNG seams), so a test drives the timeline and jitter deterministically with no real wall-clock waits and no flakiness. A test asserts: (a) under simulated repeated contention, legs retry with jittered (not identical) delays; (b) a widened-budget run eventually succeeds where the old fixed-3 would have exited contended; (c) genuine exhaustion still returns `contended`.
- [ ] Interactive/single-item CAS callers (e.g. `claim`) do NOT inherit a sluggish minute-long give-up: the widened budget is scoped to the lifecycle path (or passed as a parameter), and this scoping decision is recorded.
- [ ] The revision of the "contention retries instantly, no delay" model is RECORDED (a `## Decisions` note or an ADR), including WHY the fan-out needs jitter + a wider budget and how it stays distinct from the outage backoff regime.
- [ ] Full acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- None — can start immediately. Related (compose, not block): `advance-matrix-enumerates-held-locked-items-so-legs-fail-every-tick` (held-lock subtraction reduces the leg count; this task handles the residual legitimate contention).

## Prompt

> Self-contained. Goal: stop a lifecycle propose fan-out from leaving a large fraction of legs exiting `contended` (exit 3) on every tick. Root cause: the CAS create/publish loop that lands a treeless commit on the arbiter's `main` retries CONTENTION (a push rejected because `main` moved under us) INSTANTLY with no delay and a small fixed cap (default 3 → `advancing-lock.ts`, the `main advanced under us — refetch and retry (i/retries)` loop; exhaustion returns `{exitCode:3, outcome:'contended'}`). With N parallel legs that is a thundering herd on one ref: they collide in lockstep, exhaust the cap, and most fail even though every leg's write is valid and would land if they took turns. A lifecycle leg has no human waiting, so instant-give-up-after-3 is the wrong regime.
>
> Fix: add bounded, decorrelated-JITTER delay between contention retries (so parallel legs desync) and WIDEN the budget (more attempts / a wall-clock budget, configurable) on the lifecycle/treeless-apply path, so the fan-out DRAINS instead of thrashing. CRITICAL: do NOT conflate this with `retry-backoff.ts`'s OUTAGE regime — that file documents the deliberate split (exponential backoff models an unreachable remote that may recover; contention is a moved ref retried against the new base). Contention wants a small RANDOM delay to break lockstep, not an exponential outage ramp. This REVISES the recorded "contention retries instantly, no delay" decision for the fan-out case — record that (a `## Decisions` note, or an ADR if it meets `ADR-FORMAT.md`'s bar), with the rationale.
>
> Reuse the existing seams: inject `Sleep`/`realSleep` (as `run.ts` and `retry-backoff.ts` do) AND the RNG, mirroring the recovery-rebase jitter loop already in `integration-core.ts` (it injects both a `Sleep` seam and an RNG for deterministic jittered-retry tests) — so the retry timeline and the jitter are fully deterministic under test (no real waits, no flakiness). Keep the give-up BOUNDED (clean `contended` on exhaustion, never a hang). Do NOT slow down interactive single-item callers (`claim`): scope the wider budget to the lifecycle/treeless path or pass it as a parameter from the lifecycle driver, and record that scoping.
>
> FIRST, check this task against current reality (launch snapshot; may have drifted): re-read `advancing-lock.ts` (the contention loop + how `retries` is defaulted/threaded), `retry-backoff.ts` (the outage-vs-contention split it documents), `integration-core.ts` (the existing injected `Sleep`+RNG jitter loop to mirror), and the lifecycle driver in `advance-drivers.ts`/`advance-isolated.ts` (how treeless apply/surface/triage rungs push, and where the retry budget could be threaded). If the contention loop already gained jitter or a wider budget since this snapshot, adjust rather than duplicate. Also compose with (do not duplicate) the held-lock-subtraction sibling task. Motivating evidence: a real 66-leg lifecycle propose run left ~33 legs at exit 3 `contended` (thundering herd on `main`), while the delete/simpler legs that won a turn landed fine.
>
> Test at the seam the repo already tests: the CAS loop with injected `Sleep`+RNG. RECORD the non-obvious decisions (jitter shape, budget defaults, where the wider budget applies vs interactive callers) per the template's decision rule. Done = a lifecycle fan-out drains under simulated contention, interactive callers stay prompt, genuine exhaustion still gives `contended`, the model revision is recorded, and the full acceptance gate is green.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim jitter-and-widen-cas-contention-retry-for-lifecycle-fanout --arbiter origin   # default --arbiter origin
# then start work on the updated main:
git fetch origin && git switch -c work/jitter-and-widen-cas-contention-retry-for-lifecycle-fanout origin/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/jitter-and-widen-cas-contention-retry-for-lifecycle-fanout.md work/tasks/done/jitter-and-widen-cas-contention-retry-for-lifecycle-fanout.md
```
