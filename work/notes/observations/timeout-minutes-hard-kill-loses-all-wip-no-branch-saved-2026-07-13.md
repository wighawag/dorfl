---
title: 'The per-leg `timeout-minutes` reaps a wedged leg (good) but as a HARD SIGKILL that saves NO work to a branch, so a legitimately-long task loses everything and cannot make progress across runs'
type: observation
status: open
spotted: 2026-07-13
needsAnswers: true
---

## What was seen

The `timeout-minutes: 120` per-leg cap we added (commit adding `legTimeoutMinutes`) fired correctly on run `29235819078`: the `harden-run-test-claimed-done-flaky-under-full-suite` leg hit exactly `2h0m18s` and was reaped (`conclusion: cancelled`), instead of riding GitHub's 6h default. That is the intended protection working.

BUT: a GitHub Actions `timeout-minutes` is a HARD kill (SIGKILL of the whole runner/job), not a graceful shutdown. The dorfl `do`-agent path has no chance to run its work-preserving routing (commit WIP to the `work/<slug>` branch + push), so the log shows `Skipped pushing ... nothing to recover` and ALL of the leg's work is LOST. The next claim starts from scratch.

For a task whose legitimate work EXCEEDS the cap, this is a permanent trap: it times out, loses everything, gets requeued, times out again, forever. `harden-run-test` is exactly such a task, its acceptance ("20 consecutive full-suite runs" \u2248 100min + agent overhead) cannot fit in 2h, so it can NEVER succeed as a single CI leg. (That specific task was re-scoped to a bounded 3-run check; but the GENERAL gap remains for any task that legitimately needs > the cap.)

## Why it matters

The `timeout-minutes` cap solves the "wedged leg strands the run for 6h" problem, but introduces a "long-but-healthy leg loses all its work" problem. The two are in tension: lower the cap and more legit work is lost; raise it and a wedge strands longer. Without a way to PERSIST partial work on timeout, the cap is purely destructive for any over-cap task, there is no "continue from where it got to next run."

For an adopter, this means: a task that genuinely needs a long agent session (a big refactor, a wide migration, a soak test) is UNBUILDABLE by the autonomous loop under any finite `timeout-minutes`, because the hard kill discards the branch every time. The loop cannot make incremental progress across runs on such a task.

## The tension / options (needs a human decision)

1. **Accept it + task-shape discipline (cheapest).** Declare that autonomous CI legs MUST be scoped to fit comfortably under the cap; a task that cannot is a TASKING defect (split it, or make it human-run). Document this in the tasking protocol (a task's acceptance must be achievable within `timeout-minutes`). No engine change; the `harden-run-test` re-scope is the template. Con: some genuinely-long single-unit work has no clean split.
2. **Graceful pre-timeout checkpoint.** Set the leg's OWN internal budget BELOW `timeout-minutes` (e.g. agent/harness self-stops at 110min of a 120min cap) and use the remaining head-room to run the EXISTING work-preserving routing (commit WIP to the `work/<slug>` branch + push) so a `requeue` (continue-from-wip) resumes next run. Turns the hard kill into a soft, resumable checkpoint. This is the real fix for over-cap work; it makes `requeue` (keep) actually continue meaningful partial progress. Needs: a self-imposed sub-cap deadline in the agent/harness + a "save and exit" path wired before the GH kill.
3. **A `continue-token` / resumable-task protocol.** Heavier: let a task explicitly yield ("I did steps 1-3, resume at 4") and persist that. Overkill for now; option 2 covers most of the value.

Recommendation to weigh: ship (1) NOW as tasking discipline (cheap, prevents mis-scoped tasks like `harden-run-test` from being minted), and consider (2) as the durable fix so genuinely-long work becomes incrementally-resumable rather than impossible. (3) only if a real need appears.

## Scope note

A genuine design gap exposed by the `timeout-minutes` fix working. Repo-local (CI workflow + the do-agent/harness budget wiring); the tasking-discipline half (option 1) touches the tasking protocol docs. NOT blocking the current work, the immediate `harden-run-test` case is re-scoped, but the general "over-cap task loses all WIP" trap will bite any future long task and deserves a conscious decision (option 1 now, 2 later).

## Refs

- Run `29235819078`, job `86770202408` (`harden-run-test-claimed-done-flaky-under-full-suite`): `2h0m18s`, `conclusion: cancelled`, log `Skipped pushing ... nothing to recover`.
- The `legTimeoutMinutes` config + `timeout-minutes` template render (advance-propose / advance-merge jobs).
- The work-preserving routing that a graceful checkpoint would reuse: `saveAgentFailure` / `routeToNeedsAttention` in `packages/dorfl/src/do.ts` (commit WIP to `work/<slug>` + push).
- The re-scoped task: `work/tasks/ready/harden-run-test-claimed-done-flaky-under-full-suite.md` (the CI-timeout re-scope preamble).
