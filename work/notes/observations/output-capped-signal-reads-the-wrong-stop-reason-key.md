---
title: 'The review-gate outputCapped signal reads `stop_reason`, but real pi session logs carry `stopReason`, so it fires on every turn that produced output'
slug: output-capped-signal-reads-the-wrong-stop-reason-key
date: 2026-09-28
status: spotted
---

Spotted while building `a-truncated-agent-turn-routes-as-agent-failed`. `watch-session.ts`'s `lastAssistantTurn` reads `message.stop_reason`, and `isOutputCappedTurn` treats an `undefined` stop reason with `usage.output > 0` as a cap truncation. Real pi session logs (checked under `~/.pi/agent/sessions`) carry pi's normalised camelCase `message.stopReason` (`stop` / `toolUse` / `length` / `error` / `aborted`) and never `stop_reason`, so `LaunchResult.outputCapped` is set for essentially every pi run, and `tasker-review-loop.ts` would name any verdict parse failure a cap truncation (`ReviewOutputCappedError`). Unverified in the field; the fix is probably to read `stopReason` there too and treat `length` as the cap signal. The new `finalStopReason` / `cutOffTurnOf` path already reads `stopReason` first.
