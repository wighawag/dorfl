# `advance-triage` same-slug CAS-race flaky under full-suite load (2026-06-11)

This note was an empty placeholder for the same-slug CAS-race flake (see the
sibling notes `advance-triage-cas-race-flaky.md` and
`advance-triage-same-slug-race-flaky-under-full-suite.md` for the actual signal).

## RESOLVED 2026-06-12 (slice `triage-cas-race-test-models-real-contention`)

Test-fixture sha-collision between the two racers' identical-identity, identical-content
create commits (both got the SAME commit sha, so `applyTransition`'s post-push verify
passed for both → "2 winners"). Fixed test-only via distinct per-racer committer
identities (`racerEnv`/`raceClone` in `test/helpers/gitRepo.ts`); the product CAS is
unchanged and the one-winner assertion is intact. Full suite green across 8 consecutive
runs. See `advance-triage-cas-race-flaky.md` for the full diagnosis.
