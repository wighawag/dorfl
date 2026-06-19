---
title: watch-review-session — --watch should also tail the REVIEW gate's session, not just the implementation agent's
slug: watch-review-session
prd: review
blockedBy: []
covers: []
---

## What to build

Make `--watch` surface the **review gate's** agent conversation live, not only the **implementation** agent's. Today `--watch` shows the build agent thinking/editing, then goes quiet during the review gate — even though the review runs as its own agent and writes its own session `.jsonl`. The reviewer's reasoning (the lenses, the destination check, the verdict) is exactly what a watching human most wants to see, and it is currently invisible live (only on disk afterwards).

### Root cause (verified 2026-06-06)

`--watch` wires a `SessionTailer` around the IMPLEMENTATION agent's launch in `src/do.ts` (`runDoAgent`'s `harness.launchAsync` path), tailing the session path generated for the BUILD. The **review gate** launches a SEPARATE agent later — inside `src/complete.ts` (`performComplete`'s `review` block → `harnessReviewGate`, `src/review-gate.ts`) — with its OWN session file, and **nothing tails that one**. So the tailer stops (its `finally { tailer.stop() }` fires when the build `launchAsync` returns) BEFORE the review agent even starts.

Confirmed empirically: a single `do <slug> --review --watch` run produced TWO session files under `~/.pi/agent/sessions/<encoded-cwd>/`: `<slug>-<idA>.jsonl` (implementation) and `<slug>-<idB>.jsonl` (the review gate, opening "I'll run the review skill on this slice…"). `--watch` tailed only the first.

### The shape of the fix — EXTRACT a shared launch-with-optional-watch helper (do NOT fork)

> **This is the load-bearing requirement (raised in review 2026-06-06).** Today the watch wiring — `generateSessionPath` → `new SessionTailer` → `start()` → `launchAsync` → `finally tailer.stop()` (else sync `launch`) — exists ONLY as an INLINE block in `do.ts`'s `runDoAgent`. There is NO shared helper. The review gate launches from a DIFFERENT place (`complete.ts` → `harnessReviewGate` in `review-gate.ts`) via `harness.launch(...)` with none of that scaffolding. The WRONG fix (path of least resistance) is to COPY the watch block into the review path — that creates a second parallel implementation of watch wiring (the same duplication class as run/do's separate integrate paths; and `run.ts` would be a THIRD copy waiting to happen).
>
> **The REQUIRED fix: extract ONE shared helper that both the build launch AND the review launch call.** e.g. `launchWithOptionalWatch({harness, dir, slug, command, prompt, model, sessionId, watch, watchSink, color, env}) -> Promise<LaunchResult>` (in a shared module — `watch-session.ts` or a small new `agent-launch.ts`). It owns: generate the session path from `sessionId`; if `watch && harness instanceof PiHarness` → start a `SessionTailer` + `launchAsync` + `finally stop()`; else sync `launch`; return the `LaunchResult`. Then:
>
> - `do.ts`'s `runDoAgent` is REFACTORED to call it (build prompt/model, `sessionId = slug`) — same behaviour, now via the helper, not the inline block.
> - `harnessReviewGate` calls the SAME helper (review prompt/model, a DISTINCT `sessionId` e.g. `<slug>-review`), then parses `LaunchResult.output` as today. One codepath, two callers. A test should assert there is ONE watch implementation (e.g. the review path exercises the same helper the build path does).

What the helper must encode (the parts that were inline in `do.ts`):

- **A known session path per launch**, generated up-front via `generateSessionPath` so the tailer follows the exact file. The review launch passes a DISTINCT `sessionId` (e.g. `<slug>-review`) so its session never collides with the build's (pi already writes two distinct files; the helper just makes the path explicit).
- **Tail when `watch` is on** — the `SessionTailer` + `launchAsync` + `finally stop()`, exactly as the build path does today (moved into the helper, not copied).
- **`watch` + the watch sink threaded into the gate.** `harnessReviewGate` (and the `CompleteOptions`/`DoOptions` reaching it) must know watch is on + the `watchSink`, to pass into the helper. OFF the watch path: the helper does the sync `launch` — byte-identical to today.
- **A clear visual boundary** before the review stream (e.g. a one-line banner "▶ review gate — reviewing <slug>…"), reusing `watch-session.ts` formatting, so the human knows the build stream ended and the review stream began.

### Scope fence

- IN: EXTRACT the shared launch-with-optional-watch helper; REFACTOR the build launch (`do.ts`) onto it; route the review launch (`harnessReviewGate`) through it with a distinct session id; thread `watch`/sink into the gate; the build→review visual boundary.
- OUT: changing the review VERDICT/routing/gate logic (untouched — purely observability); the `maxReview` slicer-loop watching (separate concept, separate slice); posting to the PR (that is `review-gate-pr-comment`). Non-watch behaviour is byte-identical; the build-watch behaviour is byte-identical (just relocated into the shared helper).

## Acceptance criteria

- [ ] **ONE shared codepath:** a single launch-with-optional-watch helper is extracted; BOTH the build launch (`do.ts` `runDoAgent`, refactored onto it) AND the review launch (`harnessReviewGate`) call it. The inline watch block in `do.ts` is GONE (moved into the helper), NOT copied. A test demonstrates both paths use the same helper (no second watch implementation).
- [ ] With `do <slug> --review --watch` (pi harness), the REVIEW gate's agent conversation is surfaced live (its lenses/verdict reasoning), after the implementation stream, with a visual boundary marking the review stream — via the SAME helper the build stream uses.
- [ ] The review agent writes/uses a KNOWN, DISTINCT session path (not colliding with the build session); the tailer follows that exact path (no newest-by-mtime guessing — same discipline as the build tailer).
- [ ] `watch` + the watch sink are threaded into the review gate launch; when `--watch` is OFF, the review path is byte-for-byte unchanged (still `launch`/sync as today, no tailer).
- [ ] The review gate's VERDICT, routing (approve→integrate / block→needs-attention), and all non-observability behaviour are UNCHANGED (assert the gate decision is identical with watch on vs off).
- [ ] Tests: with watch on + a stubbed review agent that writes a session log, the review session is tailed (the sink receives the review agent's lines); with watch off, no review tailer is created and behaviour matches today. Reuse the `SessionTailer`/`watch-session` test patterns. No real model/network.
- [ ] **Test isolation:** session `.jsonl` writes go to a temp/scratch dir; the real `~/.pi/agent/sessions/` is UNTOUCHED (`isolatePiAgentDir`).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — builds on the merged review-gate (#11/#12) + the `SessionTailer` (`do-watch`/`do-watch-session-log-format`, in `done/`) + `harness-agent-output` (#12, the review launch). All on `main`. Independent of the other queued slices. (Uses the new `--review` flag once `rename-reviewpr-to-review` (PR #13) merges — reference `review`/`--review`, not `reviewPr`.)

## Prompt

> Make `--watch` ALSO tail the REVIEW gate's agent session, not just the implementation agent's. Today `--watch` wires a `SessionTailer` around the BUILD agent's `launchAsync` in `src/do.ts`; the review gate launches a SEPARATE agent later in `src/complete.ts` (`harnessReviewGate`, `src/review-gate.ts`) via `harness.launch` (sync) with no tailer — so its reasoning/verdict is invisible live (it IS written to its own session `.jsonl`, confirmed: a watched run produces two session files, only the first is tailed).
>
> FIRST run the drift check: confirm `src/do.ts`'s `--watch` path (`harness instanceof PiHarness` → `SessionTailer` + `launchAsync` + `finally tailer.stop()`) and that it wraps only the build launch; confirm `src/review-gate.ts` `harnessReviewGate` calls `harness.launch` (sync) and is handed no session path/tailer; confirm `src/complete.ts`'s `review` block invokes the gate; confirm `generateSessionPath` (`src/session-path.ts`) + `SessionTailer` (`src/watch-session.ts`) are the tools to reuse; confirm `--review` (post-PR-#13 rename) is the flag/key (NOT `reviewPr`). Route to needs-attention on any real discrepancy.
>
> Implement by EXTRACTING ONE shared helper, NOT by copying the watch block. Today the watch wiring (`generateSessionPath` → `SessionTailer` → `start` → `launchAsync` → `finally stop`, else sync `launch`) is INLINE in `do.ts`'s `runDoAgent` and there is NO shared helper — copying it into the review path would fork it (the run/do duplication anti-pattern; `run.ts` would be a 3rd copy). So: extract `launchWithOptionalWatch({harness, dir, slug, command, prompt, model, sessionId, watch, watchSink, color, env}) -> Promise<LaunchResult>` (shared module); REFACTOR `runDoAgent` to call it (build prompt/model, sessionId = slug — same behaviour); have `harnessReviewGate` call the SAME helper (review prompt/model, a DISTINCT sessionId e.g. `<slug>-review`) then parse `LaunchResult.output` as today. Thread `watch` + the watch sink from `CompleteOptions`/`DoOptions` into the gate. Print a one-line build→review boundary banner. OFF the watch path: the helper does sync `launch` — byte-identical to today. Change NO verdict/routing/gate logic — observability only.
>
> READ FIRST: `src/do.ts` (the build `--watch` wiring to mirror); `src/review-gate.ts` (`harnessReviewGate`, `ReviewGateInput`); `src/complete.ts` (the `review` block + the options that reach the gate); `src/watch-session.ts` (`SessionTailer` + formatting); `src/session-path.ts` (`generateSessionPath`); `src/harness.ts` (`launch` vs `launchAsync`).
>
> TDD with vitest, house style (stub review agent that writes a session log, temp sessions dir, `isolatePiAgentDir`): watch-on tails the review session (sink gets its lines, after the build stream, with the boundary); watch-off creates no review tailer + behaviour matches today; the gate decision is identical watch on vs off. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim watch-review-session --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/watch-review-session <remote>/main
git mv work/in-progress/watch-review-session.md work/done/watch-review-session.md
```
