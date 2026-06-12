---
title: the same-slug CAS-race "2 winners" flake SURVIVED its own fix (`triage-cas-race-test-models-real-contention` / PR #90) — #90 killed the sha-collision cause but a RESIDUAL timing window in the path-exists→lease CAS still flakes under full parallel load, and it kept redding good slices' gates this drive
date: 2026-06-12
status: open
---

## The signal

`test/advance-triage.test.ts > a same-slug new-item race ⇒ exactly one promote creates` intermittently fails "expected length 1 but got 2" under the FULL `pnpm -r test` parallel suite — i.e. TWO racers both win the create CAS. This is the flake the `triage-cas-race-test-models-real-contention` slice (PR #90) was authored to KILL. It recurred MULTIPLE times during the post-#90 drive (e.g. 1605/1606 and 1606/1607 single-failure reds), each time redding the gate of an UNRELATED slice (`run-internal-error-tests`, which touches no triage/CAS code) and routing good work to needs-attention as a false red.

## Why it survived the fix (the "second instance after a fix is a signal" case)

PR #90 fixed ONE cause: per-racer SHA collision (it introduced distinct committer identities via `racerEnv`/`raceClone` in `test/helpers/gitRepo.ts`, so the two racers' commits get distinct SHAs). That fix IS present and correct on main (verified). But the flake recurred anyway — so #90 REDUCED but did not ELIMINATE it. The residual cause is a genuine timing window in the create-CAS itself under heavy parallel load: `createAttempt` does FETCH → check `if (path exists on arbiter/main) → lost` → commit → `push --force-with-lease=main:<base>`. Under enough concurrent local-bare-repo load, both racers can pass the path-exists check against the same base and both land their `--force-with-lease` push before either's tracking ref settles — two winners. This is the SAME residual the flake-fix slice itself anticipated with its explicit STOP clause ("if reproduction shows the CAS really can yield two winners under load, STOP and surface it — that is a different, gated slice").

So: #90's distinct-identity fix addressed the sha-collision symptom; the path-exists→lease TOCTOU window under local-transport parallel load is the residual, still open.

## Why it matters

- It is no longer "a flake to re-run past" — it has now defeated a dedicated fix AND it taxes EVERY slice's full-suite gate (a single false red routes good work to needs-attention, forcing a requeue+re-run, ~an hour each time). It is the recurring bottleneck of the drive.
- The conductor correctly kept re-running per the skill's "flaky red → re-run" pitfall, but that is patching the instance; a fix-that-survived-a-fix is the signal to root-cause it, not re-run again.

## The fix (re-open the flake-fix, do NOT just re-run)

Re-examine `triage-cas-race-test-models-real-contention`'s approach — it modelled real contention but evidently did not make the assertion DETERMINISTIC under load. Options (decide by reproducing under load, per that slice's own discipline):
- make the two-racing-promote test genuinely serialise at the git layer (real separate processes / an atomic-receive arbiter / a test-only mutex through the REAL lease) so exactly-one-winner holds deterministically — WITHOUT weakening the one-winner invariant or touching product code; OR
- if reproduction shows the product CAS truly can yield two winners on a REAL remote (not just a local-bare in-process artifact), that is a genuine PRODUCT defect in the create-CAS — a different, higher-priority slice (the create path needs the lease to be authoritative, or a post-push uniqueness re-verify).

Most likely it is the former (a local-bare/in-process test artifact), but the residual must be DRIVEN OUT so the flake stops redding unrelated gates — a re-scope/extension of #90, not another re-run.

## Where

`packages/agent-runner/test/advance-triage.test.ts` (+ `test/triage-persist.test.ts`) the two-racing-promote tests; `test/helpers/gitRepo.ts` (`racerEnv`/`raceClone`, #90's fix); `src/advancing-lock.ts` `createItemThroughCas`/`createAttempt` (the path-exists→lease window) + `src/ledger-write.ts` `applyTransition` (the CAS push). Supersedes/extends the shipped `triage-cas-race-test-models-real-contention` (#90). The earlier per-instance flake observations (`advance-triage-same-slug-race-flaky-under-full-suite`, `advance-triage-cas-race-flaky`, `full-test-suite-flakes-under-parallel-load`, etc.) were DISCHARGED into that slice when it landed (correct hygiene) — so THIS note is now the sole live record of the RESIDUAL that survived the fix; do not look for those discharged files.
