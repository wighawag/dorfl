<!-- agent-runner-sidecar: item=observation:triage-cas-race-test-still-flakes-under-parallel-load type=observation slug=triage-cas-race-test-still-flakes-under-parallel-load allAnswered=false -->

## Q1

**How should this observation be dispositioned: promote it to a slice that fixes the residual flake (and if so, via option (a) serialising the test à la the sibling `serialise-review-gate-test-under-parallel-load` slice, or option (b) tightening the injected-contention model so the loser's CAS lease is provably stale before its push), or keep it open for more evidence, or drop it?**

> The same-slug promote CAS-race test in `test/advance-triage.test.ts` was observed failing once with '2 winners' during the `observation-triage-tri-state-gate` slice's acceptance gate, even though PR #90 (commit 15c00ac, `triage-cas-race-test-models-real-contention`) was specifically intended to deterministically model contention for this test. The slice's edits to this file were terminology-only; the race test body was untouched. The file passes 11/11 in isolation and the full 123-file / 1729-test suite went green on two consecutive re-runs in a throwaway clone — i.e. the failure is intermittent under full parallel load. The product CAS (`applyTransition` --force-with-lease) is sound; this is a TEST-only flake. The note explicitly recommends either (a) `describe.sequential` / pool-isolation, or (b) tightening the injected-contention model, and points at the existing `serialise-review-gate-test-under-parallel-load` slice as precedent for option (a) on a structurally identical 'green logic, racy under load' problem.

_Suggested default: promote-slice — serialise this specific test (option a), mirroring the `serialise-review-gate-test-under-parallel-load` precedent, since PR #90 already tried option (b)-style determinism and the flake survived._

<!-- q1 fields: id=q1 disposition=promote-slice -->

**Your answer** (write below this line):

promote-slice, option (a): serialise the test (mirroring the `serialise-review-gate-test-under-parallel-load` precedent). The product CAS is structurally sound (injected seam + `--force-with-lease` per-attempt nonce); this is a test-harness contention-timing flake, not a product bug. Strong evidence against option (b): PR #90 (`triage-cas-race-test-models-real-contention`, DONE) already took the tighten-the-contention-model approach and the flake survived full parallel load, whereas the serialise precedent is a clean template. A flaky acceptance-gate test erodes gate trust, so fix it deterministically. Disposition: promote-slice.
