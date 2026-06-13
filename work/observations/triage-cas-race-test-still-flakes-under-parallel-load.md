---
title: the same-slug promote CAS-race test in advance-triage.test.ts STILL flakes "2 winners" under full-suite parallel load (despite PR #90's deterministic-contention fix)
date: 2026-06-13
status: open
---

## What was observed

While driving the `observation-triage-tri-state-gate` slice (`do --isolated --review`), the acceptance gate went red on EXACTLY ONE test:

```
FAIL test/advance-triage.test.ts > advance — answered triage dispositions flow through the apply path
  > a same-slug new-item race ⇒ exactly one promote creates, the loser fails CAS
AssertionError: expected [...] to have a length of 1 but got 2
```

i.e. BOTH concurrent promotes "won" the CAS instead of exactly one. The other 1728 tests passed.

## Why this is a FLAKE, not a regression

- The slice's only change to `advance-triage.test.ts` was terminology (`autoTriage` -> `observationTriage` in doc comments + one `observationTriage: 'ask'` field). The race test's BODY (the deterministic-contention model) was untouched.
- PR #90 (`triage-cas-race-test-models-real-contention`, commit 15c00ac) ALREADY identified this exact test as flaking "2 winners under full-suite parallel load" and tried to make it deterministic by modelling real arbiter contention. The product CAS is sound; the TEST races.
- Verified empirically this session: the failing file passes 11/11 in ISOLATION, and the FULL suite (123 files / 1729 tests) passed GREEN on two consecutive re-runs of the slice's branch in a throwaway clone.

## Recommendation (for triage)

PR #90's fix REDUCED but did NOT eliminate the flake under heavy parallel load. The race test models contention via injected seams but still occasionally lets both promotes observe a pre-CAS arbiter state. Consider either (a) serialising this specific test (`describe.sequential` / run it outside the parallel pool), or (b) tightening the injected-contention model so the loser's CAS lease is provably stale before its push. This is a TEST-only concern; the product CAS (`applyTransition` --force-with-lease) is sound. Sibling note: the existing `serialise-review-gate-test-under-parallel-load` slice solved a structurally identical "green logic, racy under load" problem by serialising the test.
