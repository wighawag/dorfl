---
title: watch-review-session — --watch should also tail the REVIEW gate's session, not just the implementation agent's
slug: watch-review-session
prd: review
blockedBy: []
covers: []
---

## What to build

Make `--watch` surface the **review gate's** agent conversation live, not only the
**implementation** agent's. Today `--watch` shows the build agent thinking/editing,
then goes quiet during the review gate — even though the review runs as its own
agent and writes its own session `.jsonl`. The reviewer's reasoning (the lenses,
the destination check, the verdict) is exactly what a watching human most wants to
see, and it is currently invisible live (only on disk afterwards).

### Root cause (verified 2026-06-06)

`--watch` wires a `SessionTailer` around the IMPLEMENTATION agent's launch in
`src/do.ts` (`runDoAgent`'s `harness.launchAsync` path), tailing the session path
generated for the BUILD. The **review gate** launches a SEPARATE agent later —
inside `src/complete.ts` (`performComplete`'s `review` block →
`harnessReviewGate`, `src/review-gate.ts`) — with its OWN session file, and
**nothing tails that one**. So the tailer stops (its `finally { tailer.stop() }`
fires when the build `launchAsync` returns) BEFORE the review agent even starts.

Confirmed empirically: a single `do <slug> --review --watch` run produced TWO
session files under `~/.pi/agent/sessions/<encoded-cwd>/`:
`<slug>-<idA>.jsonl` (implementation) and `<slug>-<idB>.jsonl` (the review gate,
opening "I'll run the review skill on this slice…"). `--watch` tailed only the
first.

### The shape of the fix

The review gate currently launches via `harnessReviewGate` (`review-gate.ts`),
which calls `harness.launch(...)` (SYNC) — NOT `launchAsync`, and is handed no
session path or tailer. To watch it, the review launch needs the SAME treatment
the build launch already has:

- **A known session path for the review agent**, generated up-front (like the build
  path via `generateSessionPath`) so a tailer can follow it. It must be DISTINCT
  from the build session path (different `id`/suffix) so the two don't collide —
  pi already produced two distinct files, so the `ReviewGateInput` just needs to
  carry/derive its own session path.
- **Tail the review session when `watch` is on** — a second `SessionTailer` over
  the review session, started before the review launch and stopped after, mirroring
  the build tailer. Likely the review launch must move from `launch` (sync) to
  `launchAsync` on the watch path (the tailer needs the agent running concurrently,
  same reason the build path uses `launchAsync` under `--watch`).
- **Thread `watch` + the watch sink into the gate.** `reviewGate`/`harnessReviewGate`
  (and the `CompleteOptions`/`DoOptions` that reach it) need to know watch is on and
  where to write (the `watchSink`), so the review tailer surfaces to the same place
  the build one does. Keep it OFF the non-watch path (zero behaviour change when not
  watching).
- **A clear visual boundary** between the two streams so the human knows which agent
  is talking — e.g. a one-line banner ("▶ review gate — reviewing <slug>…") before
  the review stream, reusing the existing watch formatting (`watch-session.ts`).

### Scope fence

- IN: tailing the review gate's session under `--watch` (the second tailer + its
  session path + the watch/sink threading into `harnessReviewGate`); the
  build→review visual boundary; review launch moves to `launchAsync` on the watch
  path if needed.
- OUT: changing the review VERDICT/routing/gate logic (untouched — this is purely
  observability); the `maxReview` slicer-loop watching (separate concept, separate
  slice); posting to the PR (that is `review-gate-pr-comment`). Non-watch behaviour
  is byte-identical.

## Acceptance criteria

- [ ] With `do <slug> --review --watch` (pi harness), the REVIEW gate's agent
      conversation is surfaced live (its lenses/verdict reasoning), after the
      implementation stream, with a visual boundary marking the review stream.
- [ ] The review agent writes/uses a KNOWN, DISTINCT session path (not colliding
      with the build session); the tailer follows that exact path (no
      newest-by-mtime guessing — same discipline as the build tailer).
- [ ] `watch` + the watch sink are threaded into the review gate launch; when
      `--watch` is OFF, the review path is byte-for-byte unchanged (still
      `launch`/sync as today, no tailer).
- [ ] The review gate's VERDICT, routing (approve→integrate / block→needs-attention),
      and all non-observability behaviour are UNCHANGED (assert the gate decision is
      identical with watch on vs off).
- [ ] Tests: with watch on + a stubbed review agent that writes a session log, the
      review session is tailed (the sink receives the review agent's lines); with
      watch off, no review tailer is created and behaviour matches today. Reuse the
      `SessionTailer`/`watch-session` test patterns. No real model/network.
- [ ] **Test isolation:** session `.jsonl` writes go to a temp/scratch dir; the
      real `~/.pi/agent/sessions/` is UNTOUCHED (`isolatePiAgentDir`).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — builds on the merged review-gate (#11/#12) + the `SessionTailer`
  (`do-watch`/`do-watch-session-log-format`, in `done/`) + `harness-agent-output`
  (#12, the review launch). All on `main`. Independent of the other queued slices.
  (Uses the new `--review` flag once `rename-reviewpr-to-review` (PR #13) merges —
  reference `review`/`--review`, not `reviewPr`.)

## Prompt

> Make `--watch` ALSO tail the REVIEW gate's agent session, not just the
> implementation agent's. Today `--watch` wires a `SessionTailer` around the BUILD
> agent's `launchAsync` in `src/do.ts`; the review gate launches a SEPARATE agent
> later in `src/complete.ts` (`harnessReviewGate`, `src/review-gate.ts`) via
> `harness.launch` (sync) with no tailer — so its reasoning/verdict is invisible
> live (it IS written to its own session `.jsonl`, confirmed: a watched run produces
> two session files, only the first is tailed).
>
> FIRST run the drift check: confirm `src/do.ts`'s `--watch` path
> (`harness instanceof PiHarness` → `SessionTailer` + `launchAsync` + `finally
> tailer.stop()`) and that it wraps only the build launch; confirm
> `src/review-gate.ts` `harnessReviewGate` calls `harness.launch` (sync) and is
> handed no session path/tailer; confirm `src/complete.ts`'s `review` block invokes
> the gate; confirm `generateSessionPath` (`src/session-path.ts`) + `SessionTailer`
> (`src/watch-session.ts`) are the tools to reuse; confirm `--review` (post-PR-#13
> rename) is the flag/key (NOT `reviewPr`). Route to needs-attention on any real
> discrepancy.
>
> Implement: give the review launch a known, DISTINCT session path; when watch is
> on, start a second `SessionTailer` over it (move the review launch to
> `launchAsync` on the watch path if the tailer needs concurrency), print a
> one-line boundary banner before the review stream, and stop the tailer after.
> Thread `watch` + the watch sink from `CompleteOptions`/`DoOptions` into
> `harnessReviewGate`. OFF the watch path: byte-identical to today (sync `launch`,
> no tailer). Change NO verdict/routing/gate logic — observability only.
>
> READ FIRST: `src/do.ts` (the build `--watch` wiring to mirror); `src/review-gate.ts`
> (`harnessReviewGate`, `ReviewGateInput`); `src/complete.ts` (the `review` block +
> the options that reach the gate); `src/watch-session.ts` (`SessionTailer` +
> formatting); `src/session-path.ts` (`generateSessionPath`); `src/harness.ts`
> (`launch` vs `launchAsync`).
>
> TDD with vitest, house style (stub review agent that writes a session log, temp
> sessions dir, `isolatePiAgentDir`): watch-on tails the review session (sink gets
> its lines, after the build stream, with the boundary); watch-off creates no review
> tailer + behaviour matches today; the gate decision is identical watch on vs off.
> "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim watch-review-session --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/watch-review-session <remote>/main
git mv work/in-progress/watch-review-session.md work/done/watch-review-session.md
```
