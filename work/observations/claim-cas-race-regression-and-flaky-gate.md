# Observation: claim-CAS two-claimer race regressed + the gate let it through

_Observed 2026-06-04, during a batch `ar-run.sh` run (watching via --watch)._

## What was observed

`integration-github` was routed to `needs-attention/` by a RED acceptance gate —
but the failing test (`start.test.ts` "two-claimer race: the loser creates no
branch, the winner lands on its work branch") is **unrelated** to
`integration-github` (which only touched `integrator.ts`, 12 lines). The test
fails **deterministically on clean `main`** (5/5 in isolation): two claimers BOTH
win (`winners` has length 2, expected 1).

## Suspected cause (to verify)

The `start-readiness-guard` slice (`65f819a`) added a `git fetch` from the arbiter
**before the claim CAS** (in `claim-cas.ts`, the `options.humanPath` block, calling
`resolveReadiness`). That pre-CAS fetch appears to reset the `--force-with-lease`
baseline so the loser's push is no longer rejected → both claimers succeed. This
compromises the single most safety-critical invariant in the system
(exactly-one-claimer-wins).

## Why this matters twice

1. **Real regression** in the claim protocol's core guarantee (a fix is in flight).
2. **The gate let it merge.** `start-readiness-guard` went green at `complete --merge`
   time, so the regression slipped in — i.e. this is concrete proof the acceptance
   gate has a **race-test hole**: a timing-dependent test that can pass once and
   admit a genuine bug. This vindicates the earlier flaky-test concern that
   prompted creating `work/observations/` in the first place.

## Update 2026-06-04 — root-caused + fixed (append-only)

The earlier "claim-CAS regression" hypothesis was WRONG (corrected): the claim
protocol is sound. The flake is a TEST-HARNESS artifact — the in-process
two-claimer race pushes concurrently to a local `--bare` `file://` arbiter, and
git's `file://` transport does not serialise concurrent pushes as atomically as a
real remote, so under parallel-file CPU pressure both occasionally fast-forward.
Evidence: passes 100% with `--no-file-parallelism`, flaked ~1/3 with it on.

**Fixed in `ca74f6f`:** `vitest.config.ts` `projects` split — the 4 git-heavy/race
files (`claim-cas`/`start`/`work-on`/`run`) run in a `sequential` project
(`fileParallelism: false`); the rest stay parallel. Plus `gitEnv` now isolates
from the real global/system git config. Gate now 0/8 flake.

## Follow-ups

- [DONE] flake root-caused + fixed (`ca74f6f`).
- [idea] **gate hardening** — should the acceptance gate run race-sensitive tests
  in a way that a one-off green can't admit a real regression? Captured as a
  future idea (NOT planned per the maintainer). → move to `work/ideas/`.
- [todo] `integration-github` is in `needs-attention/` for the WRONG reason
  (this flake, not its own 12-line `integrator.ts` work). Return it to backlog /
  its branch, rebase onto the fixed `main` (`ca74f6f`), and `complete`.

_This observation is append-only and will be DELETED once `integration-github`
lands and the gate-hardening idea is captured in `work/ideas/` (git history is the
archive)._
