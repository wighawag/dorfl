---
title: An `advance --propose --watch` leg on a SURFACE outcome finishes its work (logs RELEASED) but the process NEVER EXITS — the CI job hangs ~20-55min until cancelled
type: observation
status: diagnosed
spotted: 2026-07-09
needsAnswers: false
---

## RESOLVED (root cause found, reproduced, fixed) — 2026-07-09

Fixed in `0b0039d0` (`fix(pi-harness): launchAsync resolves on pi \`exit\`, not \`close\``). The `needsAnswers` question is answered; keeping this open only until a live CI lifecycle run re-confirms end-to-end (the GitHub-hosted runner queue was backed up at fix time, so the confirming run had not started — the hang mechanism itself is conclusively reproduced and eliminated locally).

### Root cause (reproduced, NOT guessed)

`PiHarness.launchAsync` (`pi-harness.ts`) resolved its promise on the child's **`close`** event. Node fires `close` only once EVERY stdio pipe of the child is closed — and that includes pipes **inherited by any grandchild** pi spawns (an MCP server, a model proxy, a subshell). When such a grandchild OUTLIVES pi while holding the inherited stdout/stderr write end, `close` never fires, so the `await launchWithOptionalWatch(...)` inside `harnessSurfaceGate` never resolves. The surface leg therefore never returns from `runAdvanceTickWithTreelessPublish` and never reaches the CLI's `process.exit(result.exitCode)` — the whole `dorfl advance ... --watch` process hangs after logging `RELEASED`, exactly as seen.

Lead #3 in the original writeup was WRONG on one point: the single-item advance CLI path DOES `process.exit(result.exitCode)` (cli.ts ~2993), as do the multi/auto/isolated paths. The backstop already exists; the hang was that the awaited promise never resolved, so `process.exit` was never reached. So this was a real never-resolve, not a lingering-handle-after-return.

Minimal repro (in-repo now as a regression test): a stub `pi` that exits 0 immediately but leaves a `sleep 30 &` grandchild inheriting the stdio pipes. Pre-fix `launchAsync` never resolves (verified by a `Promise.race` timeout); a bare `spawn` shows `exit` firing in ~8ms while `close` never fires.

### Fix

Resolve on **`exit`** (pi itself terminated), not `close`. On exit we destroy our end of the stdio pipes and `unref` the child so a leaked grandchild's inherited FDs release what they can; a single-settle guard keeps `exit`/`error` from double-settling. The agent's answer is still read from the `.jsonl` (final once pi exited, independent of stdout). Regression test in `pi-harness.test.ts` (`launchAsync resolves on pi EXIT even when a grandchild inherits the pipes and outlives it`) is red against the old code, green with the fix. Full acceptance gate (`pnpm -r build && pnpm -r test && pnpm format:check`) green.

### Backstop decision (recorded per the ask)

No additional defensive `process.exit` was added: every advance CLI terminal path already calls `process.exit(code)` after the awaited result, so a second one would be redundant and could mask a future genuine wait. The hang required BOTH the promise never resolving AND that backstop never being reached; resolving on `exit` restores the path to it.

### Compounding data-loss symptom

The lost surfaced-question sidecar was a downstream consequence of the leg being cancelled by hand mid-flight, before `runAdvanceTickWithTreelessPublish` could publish/integrate. With the hang gone the leg completes and publishes normally, so no separate fix is needed.

### What remains (why still open, not dropped)

Only the live CI re-confirmation: dispatch run 29018787541 was still `pending` (no jobs) behind a backed-up hosted-runner queue and the `concurrency: advance-lifecycle-<ref>` group. Drop this observation via `dorfl drop obs:advance-watch-surface-leg-hangs-after-release-never-exits-2026-07-09` once a lifecycle run shows an `advance one item in-place` step on a surface/triage leg going in_progress -> completed promptly (not stuck ~20-55min) after logging RELEASED.

---

## Original writeup (preserved)

## What was seen

On the 2026-07-09 lifecycle run, the propose leg `dorfl advance "obs:runner-empty-diff-false-positive-bounces-completed-work-2026-07-09" --propose --watch --arbiter origin` printed its full, SUCCESSFUL work:

```
>> LOCKED 'observation-...' for advancing on origin (unified lock).
>> advance: surface observation:... (1 question(s), by dorfl[bot])
>> RELEASED 'observation-...' advancing borrow on origin (item untouched).
```

`RELEASED ... item untouched` is the clean terminal line — the advance logic FINISHED. Yet the GitHub Actions step `advance one item in-place (propose ⇒ opens a PR)` stayed `in_progress` for 20+ minutes (the whole run reached 55 min) and had to be CANCELLED by hand. Prior runs the same day show the same shape: two runs at ~55-56 min wall-clock that should be minutes.

So the `dorfl advance ... --watch` PROCESS completes its work but never exits — the Node event loop is kept alive by some lingering handle/child after the advance returns.

## Compounding data-loss symptom

Despite the log saying `surface ... (1 question(s))`, the question SIDECAR did NOT land on `origin/main` (`git show origin/main:work/questions/observation-<slug>.md` = absent) and the observation stayed `needsAnswers: true`. So either the treeless-CAS surface write never actually pushed before the hang, or it pushed and the hang prevented the final integration — EITHER WAY the surfaced question is lost AND the item re-surfaces (and re-hangs) every subsequent tick. (For THIS specific item the re-hang trap was removed by discharging the observation, since its content — the empty-diff bug — is already fixed in 452a68fb. But the HANG mechanism is general and will recur on any surface/triage leg.)

## Why it matters

A hung leg burns a CI runner for the full timeout (or until a human cancels), and under the `max-parallel: 4` cap a hung leg also occupies one of the 4 concurrency slots for the whole time — so a single hang throttles the whole loop, not just its own item. Combined with the possible surface-write loss, this is both a cost bug and a correctness bug on the surface/triage/apply lifecycle path (the docs-metadata rungs, which is exactly where `--watch` on a non-build outcome runs).

## What was ruled OUT by static reading (so the diagnosis starts here)

- `SessionTailer` (`watch-session.ts`): its poll timer is `unref`'d (line ~311-312) specifically so "an orphaned timer never keeps the process alive", and `stop()` does a final drain + closes the handle.
- `launchWithOptionalWatch` (`agent-launch.ts`): the watch path is `launchAsync(...)` in a `try` with `finally { await tailer.stop() }` — the tailer is always released.
- `PiHarness.launchAsync` (`pi-harness.ts` ~L198-243): resolves on the child's `close` event, drains stdout (`child.stdout.on('data', ()=>{})`), captures stderr, and `child.stdin.end()`s. The promise resolves on close.

Each piece looks correct in isolation, yet the whole hangs — so the leak is likely an INTERACTION or an environment-specific handle, NOT one of the above in isolation. This needs REPRODUCTION/PROFILING, not more static guessing (a prior same-session attempt to diagnose a different bug by static reading was wrong once).

## Suspected leads (verify, do not assume)

1. **A lingering pi GRANDCHILD or open pipe.** `launchAsync` resolves on the pi child's `close`, but if pi spawns its own child (a model-proxy, an MCP server, a subshell) that inherits the stdio pipes and does NOT exit, the parent's pipe FDs stay open and Node won't drain the loop. Check whether the surface/`--watch` path leaves any child process alive after `close` (e.g. `ps`/handle dump at the hang, or `why-is-node-running`-style diagnostics in a repro).
2. **The `--watch` path specifically on a SURFACE outcome.** The hang is on a surface leg (an observation, not a build). Does the surface/triage/apply harness launch differ from the build launch in a way that leaves the watcher or a stream attached? Reproduce a surface leg with `--watch` locally against a bare arbiter and see if the process exits.
3. **No forceExit / the CLI relies on event-loop drain.** The advance CLI path relies on the loop draining after `result` returns (unlike the `process.exit(result.exitCode)` sites elsewhere in cli.ts). If ANY handle lingers, there is no `process.exit` backstop for the advance path — so even a small leak hangs forever. A defensive `process.exit(code)` at the end of the advance CLI action (after flushing) would bound the damage regardless of the underlying leak, though the leak itself should still be found.

## Refs

- The hung run: workflow_dispatch run 29013775517 (advance-lifecycle), job "advance-propose (obs:runner-empty-diff-...)" step "advance one item in-place" stuck `in_progress` ~20+min after RELEASED; cancelled by hand 2026-07-09.
- `packages/dorfl/src/agent-launch.ts` `launchWithOptionalWatch`; `packages/dorfl/src/watch-session.ts` `SessionTailer`; `packages/dorfl/src/pi-harness.ts` `launchAsync`; `packages/dorfl/src/advance.ts` `surfaceRung` (the surface leg that hung).
- The CLI advance action in `packages/dorfl/src/cli.ts` (does it `process.exit` or drain?).

## Note on scope

A genuine, costly runner-hang bug on the lifecycle surface/triage/apply path with `--watch` on. It needs a real repro (spawn a surface leg with `--watch` against a bare arbiter and observe the process not exiting; dump open handles/child PIDs) before a fix — do NOT guess-fix. Two candidate fixes to weigh once reproduced: (a) find + close the lingering handle/child (the correct fix), and (b) a defensive `process.exit(code)` backstop on the advance CLI path so a future leak can never hang a runner indefinitely (belt-and-suspenders). A human decides whether to promote a task now (the repro + suspected leads are precise enough to) or gather a second instance first.
