---
title: the advancing-lock (and claim/slicing) CAS contends on the SHARED main ref, so N parallel legs locking DIFFERENT objects still serialise + exhaust the small retry budget — false conflicts ("main is contended", exit 3) under high (~33-way) propose-matrix parallelism
type: observation
status: spotted
spotted: 2026-06-17
slug: advancing-lock-cas-false-conflicts-on-shared-main-ref-under-high-parallelism
---

## What was seen

The CI lifecycle propose matrix ran ~33 legs in parallel; several failed with:

```
>> main advanced under us — refetch and retry (1/3)...
>> main advanced under us — refetch and retry (2/3)...
>> main advanced under us — refetch and retry (3/3)...
>> push rejected 4 times (main is contended). Try again shortly.
error: push rejected 4 times (main is contended). (exit 3)
```

These legs were locking DIFFERENT objects (different `work/advancing/<entry>.md` markers / different slugs), yet still contended and exhausted the retry budget.

## Root cause (VERIFIED against `src/advancing-lock.ts`, 2026-06-17)

The advancing lock is per-object SEMANTICALLY (a distinct marker file per entry) but its CAS substrate is the SINGLE SHARED `main` ref:

- `acquireAttempt` (`advancing-lock.ts` ~L301): `fetch` → branch off `<arbiter>/main` → write `work/advancing/<entry>.md` → commit → CAS-push that commit to `:main` with `expectedBase = <the main it branched from>`.
- The CAS succeeds only if `main` has NOT moved since the branch point. So ANY two concurrent acquires — even for totally unrelated entries — RACE on the same `main` tip: one wins, the rest see "main advanced under us", refetch, rebase their (one) marker commit, and retry.
- The retry cap is small (the logs show `retries = 3`), and there is no backoff/jitter, so ~33 legs thunder-herd the same ref and the losers blow the budget → exit 3.

The SAME shared-ref CAS pattern (and the same "main is contended" message) is in `claim-cas.ts` ~L249 and the slicing lock, so this is a general property of the tree-less-CAS-to-main design, not unique to advancing.

## Why these are FALSE conflicts

Two advancing markers for different entries NEVER tree-conflict (different files under `work/advancing/`). The rebase of a marker micro-commit onto a moved `main` is therefore always a clean, conflict-free replay. The ONLY real cost is the serialisation round-trips + the thin budget — the legs are not doing genuinely-incompatible work, they are just racing to append non-conflicting commits to one ref.

## Why it matters / possible fix shapes (decide when slicing — NOT pre-decided)

At low parallelism (a few legs) the retry budget absorbs the contention; the lifecycle propose matrix made it ~33-way, so the design's contention ceiling is now visible. Options to weigh:

- **Cheapest: bigger budget + exponential backoff WITH JITTER** on the contended retry loop (today: small cap, no jitter ⇒ thundering herd). Likely removes most of the false failures with a tiny change. Tune by expected matrix width.
- **Treat a clean non-conflicting rebase as NON-budget-consuming**, or give the contended-retry loop a much higher cap than the genuine-conflict cap, since a marker rebase can never truly conflict.
- **Concurrency cap on the matrix** (a GitHub Actions `max-parallel`) so the CAS herd is bounded to what the budget tolerates — a workflow-side mitigation, not an engine fix.
- **A bigger redesign (probably out of scope): decouple the locks from the single `main` ref** (e.g. per-entry lock refs) so non-conflicting acquires never serialise. Larger change, more moving parts; record but likely defer.

Mitigation already applied (2026-06-17): `observationTriage` set to `off` in `.agent-runner.json`, which removes the triage legs and shrinks the matrix, so the contention pressure drops in the meantime. (The triage legs were ALSO failing for an unrelated slug-keying bug — see the two sibling observations.)

## Refs

- `src/advancing-lock.ts` ~L250 (retry loop + `retries` cap), ~L278 ("main is contended" exit 3), ~L301 `acquireAttempt` (branch-off-main → CAS-push-to-:main).
- Same pattern: `src/claim-cas.ts` ~L249; the slicing lock.
- The write seam: `ledgerWrite.applyTransition({kind:'advancing', expectedBase, ...})` (the `:main` push + lease live in the strategy).
