---
title: `ENOTEMPTY: rmdir '.../.git'` on parallel test-fixture teardown flakily fails the acceptance gate, red-bouncing otherwise-fine advance-propose legs
type: observation
status: open
spotted: 2026-07-12
needsAnswers: true
---

## What was seen

On lifecycle run `29206312575`, of the 9 failed `advance-propose` legs, **5 failed on the SAME flaky infrastructure error**, not on anything wrong with their task:

```
Error: ENOTEMPTY: directory not empty, rmdir '/tmp/<prefix>-XXXX/fixture-YYYY/.git'
```

The failure is always in test-fixture CLEANUP (`Scratch.cleanup()` -> `rmSync(root, {recursive:true, force:true})` at `packages/dorfl/test/helpers/gitRepo.ts:152`), and it lands on DIFFERENT tests each run depending on scheduling:

| Job | Failing test (all in the fresh-gate `pnpm -r test`) | Path in error |
| --- | --- | --- |
| 86686290524 (mint-rename-expand-checklist-finding) | `prd-to-spec.test.ts > runPrdToSpec — idempotency` | `fixture-NxqsBx/.git` |
| 86686290538 (align-adr-format-doc-with-plain-slug) | `prd-to-spec.test.ts > runPrdToSpec — idempotency` | `fixture-eQQz1G/.git` |
| 86686290525 (surface-short-circuit-already-triaged...) | `prd-to-spec.test.ts > runPrdToSpec — idempotency` | `fixture-VBmJL7` |
| 86686290547 (requeue-reconcile-nondestructive-recovery-verb) | `pre-backlog-staging-and-promote.test.ts > STEP A` | `project-work.git/objects` |
| 86686290552 (review-protocol-add-file-ownership-lens...) | `advancing-lock.test.ts > tree-less rung` (`gitRepo.ts:152`) | `project-work.git` |

(A 6th, `86686290527 promote-rename-cutover-lessons-to-findings-note`, failed on TWO *different* tests — `cross-job-concurrent-land.test.ts` and `merge-retries-external.test.ts` — with `AssertionError: expected 2 to be 1` / `expected 2 to be <= 1`. That looks like a DIFFERENT flake — a CAS/mergeRetries race under full-suite parallel load, not the ENOTEMPTY teardown one — so it is noted here but may deserve its own line of inquiry. See "Second flake" below.)

The task CONTENT for these legs is irrelevant: several are docs-only tasks that could not possibly have caused a git-teardown race. They each ran the FULL `pnpm -r test` acceptance gate on the rebased tip and one unrelated test flaked on cleanup, so `verify` exited 1 and the engine (correctly, given a red gate) bounced the item to `stuck`.

## Why it matters

1. **The flake, not the work, decides the outcome.** An advance-propose leg that did (or would have done) correct work gets red-bounced to `stuck` purely because an UNRELATED test flaked on fixture teardown during its acceptance gate. That is a false negative on the autonomous pipeline: real progress is discarded and the item needs a manual `requeue`.
2. **It is the DOMINANT cause of this run's red.** 5 of 9 failures are this one bug. Fixing it would have turned most of the run green (modulo the surfacing bounces in the other bucket, which are healthy).
3. **It is load-correlated.** These fire under the lifecycle's `max-parallel: 4` fan-out, where up to 4 full `pnpm -r test` suites run on the same runner class concurrently; the extra I/O + process pressure widens the teardown race window. The very task at the center of the run (`harden-run-test-claimed-done-flaky-under-full-suite`) exists BECAUSE the suite is known-flaky under full load — this run is a live reproduction.

## Root-cause hypothesis (verify, do not assume)

`Scratch.cleanup()` does `rmSync(root, {recursive:true, force:true})`. Node's `force:true` suppresses `ENOENT` (missing path) but does NOT make a recursive remove immune to `ENOTEMPTY`: if, DURING the recursive walk, a live process still holds or repopulates a subdir (classically a `.git`/`.git/objects` dir with a lingering `git` child process, an OS file-indexer, or a sibling test still walking that tree), the `rmdir` of that dir races the last unlink and throws `ENOTEMPTY`. The path in every case is a `.git` (or `.git/objects`) dir, which is exactly where a `git` subprocess or a pack/gc operation would still hold handles. So the suspected mechanism is: a git subprocess (or fs handle) outlives the test body and is still touching the fixture `.git` when `cleanup()` fires.

### Candidate fixes to weigh (do NOT guess-pick)

- **Retry the remove.** Wrap the `rmSync` in a bounded retry-with-backoff (Node's `fs.rm` supports `maxRetries`/`retryDelay` for exactly EBUSY/EMFILE/ENOTEMPTY/EPERM on Windows, but the sync path's retry coverage differs by platform/Node version — verify it actually retries ENOTEMPTY on Linux, since these ran on `ubuntu-latest`). If `rmSync` retries do not cover ENOTEMPTY on Linux, use `rmSync` in a manual retry loop or switch cleanup to async `fs.rm` with `maxRetries`.
- **Await git subprocesses.** Ensure every `git` child a test spawns is fully awaited/reaped before `cleanup()` runs, so nothing holds the `.git` tree at teardown. This attacks the cause, not the symptom.
- **Lower fixture contention.** If teardown races only manifest at parallelism, consider marking the git-heavy suites `sequential` (some already are; the ENOTEMPTY hit both `parallel` and `sequential`-tagged tests, so this alone may be insufficient).

The RIGHT fix is likely "reap git subprocesses before cleanup" PLUS "retry the remove as a belt-and-suspenders". A reproduction under load (run `pnpm -r test` in a tight loop, or with reduced I/O, on Linux) should precede any fix — this is a race, so guess-fixing risks papering over it.

## Second flake (separate, noted not diagnosed)

`86686290527` failed on `cross-job-concurrent-land.test.ts` and `merge-retries-external.test.ts` with `expected 2 to be 1` / `expected 2 to be <= 1` (a contender that should have bounced past the `mergeRetries` cap=0 instead converged, or vice-versa). This is a CAS/merge-retry timing assertion, a DIFFERENT flake class from the ENOTEMPTY teardown race. It may share the "full-suite parallel load perturbs timing" root, but the symptom is a wrong-count assertion, not a teardown error. Flagged for a separate look; do not fold it into the ENOTEMPTY fix.

## The other failures in this run (for completeness — these are NOT this bug)

3 of the 9 failed legs were HEALTHY refusals, the `fail-fast:false` isolation and surface-not-fabricate behaviour working as designed (each exits non-zero, so the job is red, but the system did the right thing):

- `86686290513 exempt-work-questions-sidecars-from-prd-word-leak-scan`: premise stale — the fix already landed on main in `970ce7eb`. Agent bounced to `stuck`, suggested moving the task body to `done`.
- `86686290522 provenance-file-basenames-widened-criterion-and-expiry-guard`: the observation it was told to edit was already discharged-by-deletion; agent surfaced a real convention collision (discharge-by-deletion vs amend-source-observation) instead of guessing.
- `86686290541 sweep-prose-prd-colon-from-live-maintained-docs-2026-07-12`: empty diff vs main (nothing left to sweep); bounced as a no-op.

And the 9th, `86686290516 harden-run-test-claimed-done-flaky-under-full-suite`, was the API-rate-limited slow leg cancelled by hand — see `advance-propose-build-leg-has-no-timeout-minutes-so-a-wedged-agent-strands-the-run-for-6h-2026-07-12.md`.

## Refs

- Run `29206312575` (advance-lifecycle). Failed jobs: 86686290524, 86686290525, 86686290527, 86686290538, 86686290547, 86686290552 (ENOTEMPTY teardown); 86686290513, 86686290522, 86686290541 (healthy refusals); 86686290516 (throttled slow leg, separate note).
- `packages/dorfl/test/helpers/gitRepo.ts:152` — `Scratch.cleanup()` -> `rmSync(root, {recursive:true, force:true})`.
- Tests observed flaking: `test/prd-to-spec.test.ts`, `test/pre-backlog-staging-and-promote.test.ts`, `test/advancing-lock.test.ts` (ENOTEMPTY); `test/cross-job-concurrent-land.test.ts`, `test/merge-retries-external.test.ts` (count-assertion flake).
- Directly related existing task: `harden-run-test-claimed-done-flaky-under-full-suite` (the known "suite flaky under full load" work) — this observation gives it concrete reproductions.

## Note on scope

A genuine, high-value test-infra reliability bug: the DOMINANT cause of autonomous-run red is a fixture-teardown race, not bad work. It is a repo-local TEST fix (touches `packages/dorfl/test/helpers/`, not the protocol under `skills/setup/protocol/` or `work/protocol/`). A reproduction under load should precede a fix (it is a race). A human decides whether to fold this into the existing `harden-run-test-...` task or promote a dedicated task; either way, the reproductions above are precise enough to act on.

## Update 2026-07-13: the `rmrf` retry was NECESSARY but INSUFFICIENT — root cause is git auto-gc

On advance-lifecycle run 29235819078 the flake RECURRED on two legs even though both sites already routed through `rmrf` (`integration-core.test.ts` via `makeScratch().cleanup()`, `prd-to-spec.test.ts` via `rmrf` directly). The error was `ENOTEMPTY: rmdir '.../.git/objects/pack'` — i.e. git's BACKGROUND `gc --auto` / maintenance repack was still writing pack files into `.git/objects/pack` when teardown ran, and 10×50ms of retry backoff could not outlast a mid-flight repack.

ROOT-CAUSE FIX (attacks the cause, not the symptom): disable git auto-maintenance in ALL test fixtures by threading `gc.auto=0` + `maintenance.auto=false` + `gc.autoDetach=false` through `gitEnv()` via the `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` env mechanism (which composes even under `GIT_CONFIG_GLOBAL=/dev/null` + `GIT_CONFIG_NOSYSTEM=1`). With no background repack ever running, there is no writer to race the teardown. The `rmrf` retry budget was also raised (10×50ms → 50×100ms, ~5s) as a belt-and-suspenders backstop for any residual OS-level lag. Verified: the two flaking files 6/6 clean under repeat, full `pnpm -r test` green. This is the generalise-the-fix response the earlier `rmrf`-only pass should have reached (REVIEW-PROTOCOL discipline 4: a second instance ⇒ generalise).
