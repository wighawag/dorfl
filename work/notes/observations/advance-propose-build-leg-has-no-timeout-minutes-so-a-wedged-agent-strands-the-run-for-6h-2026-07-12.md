---
title: An `advance-propose` BUILD leg has no `timeout-minutes`, so a wedged agent session strands the whole lifecycle run for up to the 6h default cap
type: observation
status: open
spotted: 2026-07-12
needsAnswers: true
---

## What was seen

On lifecycle run `29206312575` (workflow_dispatch, `propose` mode), one matrix leg wedged and blocked the whole run:

- Leg: `advance-propose (task:harden-run-test-claimed-done-flaky-under-full-suite)`, job `86686290516`.
- Step `advance one item in-place (propose ⇒ opens a PR)` running `dorfl advance <item> --propose --watch --arbiter origin`.
- `started_at` **19:44:53 UTC**, still `in_progress` at **21:44 UTC** = exactly **~2h0m** with `completed_at: null`. Cancelled by hand at 21:45:26.

### Post-cancel log analysis (root cause is now MUCH clearer — this is NOT a dead hang)

The downloaded job log shows the agent was NOT frozen — it kept emitting tool calls (`▶ bash`, `▶ read`) the whole time, but with escalating multi-minute-to-HOUR gaps BETWEEN consecutive tool calls:

```
19:45:45  ▶ bash
20:05:16  ▶ bash    <- ~19.5 min gap
20:44:15  ▶ bash    <- ~39 min gap
20:44:17..20:44:56  ▶ bash x9  (a fast burst)
21:45:01  ▶ bash    <- ~60 min gap (exactly one hour)
21:45:26  ##[error] The operation was canceled.
```

So the leg was making SLOW progress, not hung: individual agent TURNS stalled for ~20/39/60 minutes each. A stall BETWEEN a tool result and the next tool call, in bursts separated by ~1h, is the signature of **model-provider rate-limiting / 429 backoff** — exactly the failure mode the workflow's own `max-parallel: 4` comment warns about ("429s that strand legs as transient-infra stuck"). The `--watch` stream was not dead, it was STARVED: the agent was blocked waiting on the throttled API between turns. On cancel, the runner terminated a healthy tree of orphan processes (`node`, `pi`, `bash`, `sh`) — consistent with a live-but-throttled session, not a crashed/deadlocked one.

The task under build was `harden-run-test-claimed-done-flaky-under-full-suite` (hardening a flaky test), so the long individual bash calls are plausibly full-suite runs, compounding the wall-clock on top of the API stalls.

- Every OTHER leg had long since finished (4 success, 8 failure); `advance-merge` skipped (propose mode). So the single slow leg was the only thing keeping the run `in_progress`.

## Why it matters

The `advance-propose` job (`.github/workflows/advance-lifecycle.yml` L237+) has **no `timeout-minutes`** at the job or step level (`grep -n timeout` on the workflow = NONE). It therefore inherits GitHub's **default 360-minute (6h)** job cap. A wedged agent session (silent, no terminal line) rides that full 6h ceiling unless a human notices and cancels. Under the `max-parallel: 4` fan-out cap, a hung leg also squats one of the 4 concurrency slots the entire time, throttling the whole loop, not just its own item. This is a cost bug (up to 6h of runner minutes per hang) and an availability bug (the lifecycle run cannot complete/report until the hang clears).

## How this DIFFERS from `advance-watch-surface-leg-hangs-after-release-never-exits-2026-07-09`

That earlier observation (fixed in `0b0039d0`: `launchAsync` resolves on pi `exit`, not `close`) was a **SURFACE leg** that logged its clean terminal line `RELEASED ... item untouched` and THEN failed to exit (a lingering-grandchild-pipe never-resolve, post-completion). The mechanism there was: work done, process won't die.

This is different on two axes and is NOT obviously the same root cause:

1. It is a **BUILD/propose leg** (`task:...`, a real build + Gate-2 review agent session), not a docs-metadata surface/triage rung.
2. It stalled MID-FLIGHT (no `RELEASED`, no `PR opened`) but was NOT wedged — the log (above) shows tool calls still firing, just with ~20-60 min gaps between agent turns from API throttling. So this is a SLOW leg, not a dead one.

So the `exit`-vs-`close` fix does not cover this: there was no never-resolve and no completion to exit from — the agent was genuinely still working, just rate-limited. This is the `max-parallel: 4` 429-strand failure mode the workflow comments predicted, realised on the build path.

## The systemic gap (the durable point, independent of this one instance's root cause)

Regardless of WHY a given agent session wedges, there is no bound on how long a single leg may hang: no `timeout-minutes` means the floor is GitHub's 6h default. A modest `timeout-minutes` on the `advance-propose` (and `advance-merge`) job would reap a wedged leg in minutes and free its concurrency slot, converting a silent 6h strand into a fast, visible leg-failure that the `fail-fast: false` matrix already tolerates (siblings unaffected; the item just isn't advanced this tick and is retried next tick). The build agent session presumably has its own internal budget, but that budget clearly did not fire here (2h silent) — so a job-level `timeout-minutes` is the reliable backstop.

## Confirmed / narrowed (from the log, not guessed)

1. **CONFIRMED: model-provider throttling between turns, NOT a code deadlock.** The tool-call cadence (bursts separated by ~20/39/60 min stalls) is classic 429 backoff. The workflow's `max-parallel: 4` fan-out means up to 4 full agent sessions hammer the same provider key concurrently; when the account tips over the rate limit, per-turn backoff stretches each leg's wall-clock unboundedly. This is the predicted `max-parallel: 4` strand, on the build path.
2. **RULED OUT: `--watch` never-resolve / tailer-detach.** The log proves the agent kept emitting turns to the end, so this is not the 2026-07-09 `close`-vs-`exit` never-exit bug and not a detached tailer.

### Still open (verify)

1. **No per-leg wall-clock deadline anywhere in `dorfl advance --propose`.** Determine whether the engine imposes ANY cap on a single advance leg; the log implies not (the ONLY bound today is the GH 6h default). A per-leg budget in the engine OR a job `timeout-minutes` bounds it.
2. **Should `max-parallel` be lower, or should legs share a rate-limit-aware scheduler?** 4 concurrent full agent sessions on one provider key is the throttle trigger. Options: lower `max-parallel`, a token-bucket across legs, or a provider tier with higher limits.
3. **429 backoff shape.** Confirm whether the agent's model client caps total backoff or can grow to ~1h waits (the 60-min gap suggests very long backoff or repeated re-throttling).

## Recommended action (for a human to weigh)

- Cheap, high-value backstop NOW: add `timeout-minutes: <N>` to the `advance-propose` and `advance-merge` jobs (pick `<N>` above a legitimate worst-case build-agent session but well under 6h). This is independent of finding the root cause and immediately caps the blast radius. NOTE this is a host-workflow change, NOT a protocol change (the workflow is repo-local CI), so it does not touch `skills/setup/protocol/` or `work/protocol/`.
- Root-cause the wedge itself (leads above) as a separate, deeper task; a repro is needed before a fix (do not guess-fix), mirroring how the 2026-07-09 surface-hang was handled.

## Refs

- Hung run: `29206312575` (advance-lifecycle, workflow_dispatch). Job `86686290516` = `advance-propose (task:harden-run-test-claimed-done-flaky-under-full-suite)`, step `advance one item in-place (propose ⇒ opens a PR)` stuck `in_progress` ~2h+ with no output, cancelled by hand 2026-07-12.
- `.github/workflows/advance-lifecycle.yml` L237+ (`advance-propose` job; no `timeout-minutes`); the `run: dorfl advance "${{ matrix.item }}" --propose --watch --arbiter origin` step.
- Related but distinct: `work/notes/observations/advance-watch-surface-leg-hangs-after-release-never-exits-2026-07-09.md` (surface-leg, clean-finish-won't-exit, fixed in `0b0039d0`).

## Note on scope

A genuine reliability + cost gap on the autonomous lifecycle path. The `timeout-minutes` backstop is a small, safe, immediately-actionable CI change; the underlying agent-session wedge is a deeper diagnosis that needs a reproduction before any fix. A human decides whether to promote a task for the backstop now (precise enough to) and/or gather a second instance of the mid-flight wedge before chasing root cause.
