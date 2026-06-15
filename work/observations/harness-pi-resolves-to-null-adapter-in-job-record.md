---
title: A repo configured `harness: "pi"` records `harness.adapter: "null"` in the job record — the null/shell adapter shell-launches pi, so work happens, but the recorded adapter + the missing pi session pointer are confusing for status/--watch/gc liveness
date: 2026-06-15
status: open
---

## The signal

During a drive, the live job record `…/install-ci-build-slice-tick-workflow.json` showed:

```json
{ "slug": "install-ci-build-slice-tick-workflow", "harness": { "adapter": "null" }, "state": "running" }
```

even though the repo's `.agent-runner.json` (in the same job worktree) declares `"harness": "pi"`. The build agent IS doing real work (the worktree's vitest `results.json` shows the agent's new `build-slice-tick-template.test.ts` passing), so this is NOT "no agent ran" — the null/shell adapter shell-launches pi and the agent builds. The confusion is purely in the RECORD + observability:

- The job record names adapter `null`, not `pi`, so `status`/`gc` re-derive liveness from the null adapter's PID-only signal, NOT from a pi session handle.
- There is NO `harness.session` pointer (the pi session dir/log path the pi adapter records), so `do --watch` / any session-log tailer has nothing to tail, and there is no `.jsonl` to find when auditing "which session did this work?". (This is what made tracing the agent's session impossible during the drive.)

## Why it matters

`harness.ts` documents that liveness MUST come from the harness's real signal and that the pi adapter's whole point is "liveness via PID + a pointer to the pi session dir/log". If a repo asks for `pi` but the job is launched under the `null` adapter, you lose the pi-specific liveness + the session pointer, while still running pi underneath. So:

- a thinking-but-quiet pi agent could be mis-judged by PID-only liveness in edge cases,
- `--watch` and post-hoc audit ("show me the session that built this slice") silently have nothing to attach to,
- the recorded adapter disagrees with the resolved `harness` config, which is a debuggability trap.

## Open questions (for triage, not asserted)

1. Is `harness: "pi"` SUPPOSED to resolve to a dedicated pi adapter that records a `session` pointer, and the `null` adapter is leaking through on this path (`do --isolated`)? Or is the current design genuinely "pi is run via the null/shell adapter for now" (the pi adapter being a later slice per `harness.ts`'s note)?
2. If the latter, should the job record at least carry the shell-launched pi's `--session` path as `harness.session` so `--watch`/audit work regardless of adapter?
3. Should a `harness: "pi"` config that resolves to the `null` adapter WARN at startup, so the mismatch is visible rather than silent?

## Provenance

Observed live while trying to answer "which session file is the build agent writing to?" during a drive-backlog run on the install-ci slices; could not locate any pi `.jsonl` because the job ran under the null adapter with no recorded session pointer. Not investigated deeply against the adapter-resolution code — captured as a spotted signal for triage.
